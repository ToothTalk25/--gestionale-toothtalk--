-- =====================================================================
-- 0113_pacchetto_elementi_meta_download_admin.sql — il Titolare deve poter
--                                    verificare video/copertina/dichiarazione
--                                    prima del sigillo, non solo vederne i metadati
-- =====================================================================
-- pacchetto_elementi_meta (0109) espone di proposito SOLO i metadati
-- (nome file, dimensione, data) e mai bucket/storage_path, perché un membro
-- non deve poter derivare da qui il percorso di un file — in particolare
-- del video di dichiarazione (Art. 4.1), riservato al solo Titolare.
--
-- Il Titolare però è già l'eccezione ammessa da ogni policy coinvolta
-- (storage.originali_select, storage.finali_select, deliverable_versions
-- versions_select): può già leggere questi oggetti via RLS. Gli mancava
-- solo un modo per farlo dall'interfaccia del pacchetto, per verificare un
-- video/copertina/dichiarazione PRIMA di sigillare, invece di scoprirne
-- eventuali problemi solo dopo (quando sigillo e PEC sono già partiti).
--
-- bucket/storage_path vengono quindi aggiunti al risultato, ma valorizzati
-- SOLO quando il chiamante è admin (case when is_admin() then ... end):
-- per chi non è admin restano null, esattamente come prima.
-- =====================================================================

-- Il tipo di riga cambia (due colonne in più): create or replace non basta,
-- Postgres richiede di eliminare prima la funzione esistente.
drop function if exists public.pacchetto_elementi_meta(uuid);

create function public.pacchetto_elementi_meta(p_pacchetto uuid)
returns table (
  ruolo             public.ruolo_elemento,
  version_id        uuid,
  file_name         text,
  sha256            text,
  size_bytes        bigint,
  uploaded_at       timestamptz,
  archiviato_esterno boolean,
  bucket            text,
  storage_path      text
)
language plpgsql security definer set search_path = public as $$
declare
  v_polo uuid;
begin
  select t.polo_id into v_polo
    from public.pacchetti_video p
    join public.tasks t on t.id = p.task_id
   where p.id = p_pacchetto;

  if v_polo is null then
    raise exception 'Pacchetto non trovato' using errcode = 'P0001';
  end if;

  if not (public.is_admin() or public.can_read_polo(v_polo)) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  return query
    select pe.ruolo, v.id, v.file_name, v.sha256, v.size_bytes,
           v.uploaded_at, v.archiviato_esterno,
           case when public.is_admin() then v.bucket end,
           case when public.is_admin() then v.storage_path end
      from public.pacchetto_elementi pe
      join public.deliverable_versions v on v.id = pe.version_id
     where pe.pacchetto_id = p_pacchetto;
end $$;

-- Il grant execute esiste già dal 0109: create or replace non lo tocca,
-- ma lo riaffermiamo per chiarezza e per non dipendere da quel dettaglio.
grant execute on function public.pacchetto_elementi_meta(uuid) to authenticated;
