-- =====================================================================
-- 0141_policy_una_volta.sql — le policy si valutano una volta, non per riga
-- =====================================================================
-- Perché. Ogni espressione di policy viene valutata PER OGNI RIGA che la query
-- tocca. Dentro queste espressioni ci sono chiamate a funzioni SENZA argomenti
-- — is_admin(), accesso_progetti(), auth.uid() — il cui valore non cambia da
-- una riga all'altra: vengono però richiamate riga per riga.
--
-- Misurato prima di questa migrazione (pg_stat_statements, registro del
-- gestionale su 272 righe): 316 letture, 20,79 ms di media ciascuna. Non è il
-- volume dei dati (15 MB in tutto): sono le ~540 chiamate a funzione che la
-- policy si fa per riga. Con la valutazione singola il database calcola quel
-- valore UNA volta e lo riusa.
--
-- Come. Si riscrivono le espressioni esistenti sostituendo:
--
--   is_admin()            →  (select is_admin())
--   accesso_progetti()    →  (select accesso_progetti())
--   auth.uid()            →  (select auth.uid())
--
-- La parentesi con select davanti non cambia il valore: lo calcola una volta
-- sola (InitPlan) invece che a ogni riga. È la correzione che Supabase stessa
-- documenta per le policy RLS (lint "auth_rls_initplan").
--
-- Le funzioni che DIPENDONO dalla riga (is_member_of(polo_id),
-- storage_polo_id(name), polo_of_task(task_id)) si lasciano intatte: lì il
-- valore cambia davvero da riga a riga, e non c'è niente da guadagnare.
--
-- Riscrivere invece di riscrivere a mano. Le espressioni sono tante (una
-- cinquantina di policy su 16 tabelle, fra public e storage) e ricopiarle a
-- mano è il modo più facile per cambiare un permesso senza accorgersene. Qui si
-- legge l'espressione COS'È nel database, si applica la sostituzione e si
-- riscrive la stessa policy con la sola differenza della valutazione: nessun
-- permesso cambia, e chi legge può confrontare prima/dopo.
--
-- Idempotente: se un'espressione è già a valutazione singola, il token non
-- viene toccato un secondo giro (la migrazione si può riapplicare senza
-- annidare parentesi). Verificato con `npm run migra -- 0141 --verifica`.
--
-- Gli indici che servono a questa stessa lettura stanno in 0142: qui solo
-- espressioni di policy, così il guadagno di questa modifica si può misurare
-- da solo.
-- =====================================================================

-- Il trasformatore, in una funzione temporanea: vive solo per questa sessione
-- (pg_temp) e sparisce da sola, quindi non resta niente nel database pubblico.
create function pg_temp.una_volta(e text) returns text language plpgsql as $fn$
declare
  x text := e;
begin
  -- is_admin() — nessun argomento: il risultato è lo stesso per tutte le righe.
  if x !~* '\(\s*select\s+(public\.)?is_admin\(\)' then
    x := replace(x, 'public.is_admin()', 'is_admin()');
    x := regexp_replace(x, '(^|[^a-zA-Z_])is_admin\(\)', '\1(select is_admin())', 'g');
  end if;

  -- accesso_progetti() — idem: legge il profilo, non la riga interrogata.
  if x !~* '\(\s*select\s+(public\.)?accesso_progetti\(\)' then
    x := replace(x, 'public.accesso_progetti()', 'accesso_progetti()');
    x := regexp_replace(x, '(^|[^a-zA-Z_])accesso_progetti\(\)', '\1(select accesso_progetti())', 'g');
  end if;

  -- auth.uid() — l'identificativo dell'utente collegato.
  if x !~* '\(\s*select\s+auth\.uid\(\)' then
    x := regexp_replace(x, '(^|[^a-zA-Z_])auth\.uid\(\)', '\1(select auth.uid())', 'g');
  end if;

  return x;
end;
$fn$;

do $$
declare
  r record;
  nuovo text;
  cambiate int := 0;
begin
  for r in
    select n.nspname as schema, c.relname as tabella, p.polname as policy,
           pg_get_expr(p.polqual, p.polrelid) as usando,
           pg_get_expr(p.polwithcheck, p.polrelid) as controllo
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'storage')
       and (
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'is_admin\(\)|accesso_progetti\(\)|auth\.uid\(\)'
         or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'is_admin\(\)|accesso_progetti\(\)|auth\.uid\(\)'
       )
     order by n.nspname, c.relname, p.polname
  loop
    if r.usando is not null then
      nuovo := pg_temp.una_volta(r.usando);
      if nuovo <> r.usando then
        execute format('alter policy %I on %I.%I using (%s)', r.policy, r.schema, r.tabella, nuovo);
        raise notice 'USING  %.% — %.%', r.schema, r.tabella, r.policy, nuovo;
        cambiate := cambiate + 1;
      end if;
    end if;

    if r.controllo is not null then
      nuovo := pg_temp.una_volta(r.controllo);
      if nuovo <> r.controllo then
        execute format('alter policy %I on %I.%I with check (%s)', r.policy, r.schema, r.tabella, nuovo);
        raise notice 'CHECK  %.% — %.%', r.schema, r.tabella, r.policy, nuovo;
        cambiate := cambiate + 1;
      end if;
    end if;
  end loop;

  raise notice 'Policy riscritte: %', cambiate;
end;
$$;

-- Controllo finale: per ciascuna delle tre funzioni non deve restare nessuna
-- chiamata FUORI da una valutazione singola. Il controllo guarda il testo
-- dell'espressione, e dopo la riscrittura la chiamata c'è ancora: per questo
-- conta solo quelle NON precedute da `select`.
do $$
declare
  r record;
  rimaste int := 0;
begin
  for r in
    select n.nspname as schema, c.relname as tabella, p.polname as policy,
           pg_get_expr(p.polqual, p.polrelid) as usando,
           pg_get_expr(p.polwithcheck, p.polrelid) as controllo
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'storage')
  loop
    if (coalesce(r.usando, '') ~ 'is_admin\(\)' and coalesce(r.usando, '') !~* '\(\s*select\s+(public\.)?is_admin\(\)')
       or (coalesce(r.controllo, '') ~ 'is_admin\(\)' and coalesce(r.controllo, '') !~* '\(\s*select\s+(public\.)?is_admin\(\)')
       or (coalesce(r.usando, '') ~ 'accesso_progetti\(\)' and coalesce(r.usando, '') !~* '\(\s*select\s+(public\.)?accesso_progetti\(\)')
       or (coalesce(r.controllo, '') ~ 'accesso_progetti\(\)' and coalesce(r.controllo, '') !~* '\(\s*select\s+(public\.)?accesso_progetti\(\)')
       or (coalesce(r.usando, '') ~ 'auth\.uid\(\)' and coalesce(r.usando, '') !~* '\(\s*select\s+auth\.uid\(\)')
       or (coalesce(r.controllo, '') ~ 'auth\.uid\(\)' and coalesce(r.controllo, '') !~* '\(\s*select\s+auth\.uid\(\)') then
      rimaste := rimaste + 1;
      raise warning 'Rimasta per riga: %.%.%', r.schema, r.tabella, r.policy;
    end if;
  end loop;

  if rimaste > 0 then
    raise exception 'Restano % policy con chiamate valutate per riga.', rimaste;
  end if;
  raise notice 'Nessuna policy con is_admin()/accesso_progetti()/auth.uid() valutata per riga.';
end;
$$;
