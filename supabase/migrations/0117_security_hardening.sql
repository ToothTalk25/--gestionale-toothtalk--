-- =====================================================================
-- 0117_security_hardening.sql — archivia solo admin, privilegi ridotti
-- =====================================================================
-- Due indurimenti emersi dall'audit di sicurezza:
--
-- 1. archivia_file_finale() era SECURITY DEFINER senza alcuna verifica
--    d'identità: essendo eseguibile da anon/authenticated via PostgREST
--    RPC, chiunque (anche non autenticato, conoscendo un version_id) poteva
--    marcare come "archiviato all'esterno" un file sigillato di un pacchetto
--    certificato. Il flag alimenta le decisioni di archiviazione/storage:
--    una marca falsa compromette la catena (il file risulta già esportato
--    quando non lo è). L'archiviazione è una prerogativa dell'accesso
--    globale (l'app la espone solo nelle action admin): il DB ora lo impone.
--
-- 2. Il ruolo authenticated aveva (grants di default di Supabase)
--    TRUNCATE / REFERENCES / TRIGGER su tutte le tabelle pubbliche.
--    TRUNCATE NON è soggetto alla RLS: un privilegio dormiente ma letale se
--    mai raggiunto da un altro vettore. REFERENCES e TRIGGER non servono a
--    nessun client. Restano SELECT/INSERT/UPDATE/DELETE, che la RLS governa.
-- =====================================================================

-- 1. Guardia su archivia_file_finale: solo chi ha accesso globale.
create or replace function public.archivia_file_finale(p_version uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Operazione riservata a chi ha accesso globale'
      using errcode = '42501';
  end if;

  update public.deliverable_versions
     set archiviato_esterno = true
   where id = p_version
     and bucket = 'finali'
     and exists (
       select 1 from public.pacchetto_elementi pe
       join public.pacchetti_video p on p.id = pe.pacchetto_id
       where pe.version_id = p_version
         and p.stato in ('sigillato','pec_inviata','pec_confermata')
     );

  if not found then
    raise exception 'Il file non esiste, non è nel bucket finale o il pacchetto non è certificato';
  end if;
end $function$;

-- 2. Privilegi pericolosi e inutili via: TRUNCATE/REFERENCES/TRIGGER.
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'v', 'p', 'm')
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from authenticated, anon',
      r.relname
    );
  end loop;
end $$;
