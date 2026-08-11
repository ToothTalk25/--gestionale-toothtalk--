-- =====================================================================
-- 0043_archiviazione_esterna.sql — rimozione file fisico, hash intatto
-- =====================================================================
-- Una volta che un file sigillato è stato copiato su Drive (esportazione
-- automatica al sigillo) e archiviato manualmente su hard disk esterno,
-- chi ha accesso globale può rimuovere il blob dallo storage Supabase per
-- risparmiare spazio. La riga nel database resta con la sua impronta
-- SHA256 (la prova legale) — il download diventa non disponibile, ma la
-- catena di integrità e il manifesto certificato non cambiano.
-- =====================================================================

alter table public.deliverable_versions
  add column if not exists archiviato_esterno boolean not null default false;

comment on column public.deliverable_versions.archiviato_esterno is
  'Il file fisico è stato rimosso dallo storage Supabase e archiviato '
  'esternamente (Drive + hard disk). La riga e lo SHA256 restano: la '
  'prova legale è nell''impronta, non nei byte.';

create or replace function public.archivia_file_finale(p_version uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
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
end $$;

grant execute on function public.archivia_file_finale(uuid) to authenticated;
