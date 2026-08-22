-- =====================================================================
-- 0098_revoca_video_on_screen_array.sql — esecuzione della revoca MANUALE
-- =====================================================================
-- 0089 aveva definito revoca_video_on_screen(p_user uuid): marcava
-- revocato_gdpr = true per TUTTI i video_grezzo/audio caricati da un utente
-- (uploaded_by). Quella firma è il cuore del difetto eliminato: la
-- cancellazione basata sull'uploader non è corretta perché il sistema non
-- sa chi compare nel file. La chiamata automatica è stata rimossa da
-- revocaImmagineVoce (vedi redesign); questa funzione ora serve SOLO
-- all'esecuzione manuale del Coordinatore, che seleziona esplicitamente i
-- singoli version_id da eliminare.
--
-- Nuova firma: revoca_video_on_screen(p_version_ids uuid[]).
--   - permesso ristretto a is_admin() (non più auto-revoca self-service);
--   - marca revocato_gdpr/revocato_at SOLO per gli id selezionati
--     (transizione già consentita dal trigger fn_versions_append_only);
--   - restituisce (version_id, bucket, storage_path, task_id) così la
--     server action può cancellare i file dallo storage.
-- =====================================================================

create or replace function public.revoca_video_on_screen(p_version_ids uuid[])
returns table (
  version_id   uuid,
  bucket       text,
  storage_path text,
  task_id      uuid
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Operazione riservata al Titolare' using errcode = '42501';
  end if;

  if p_version_ids is null or cardinality(p_version_ids) = 0 then
    return;
  end if;

  update public.deliverable_versions v
     set revocato_gdpr = true,
         revocato_at   = now()
   where v.id = any (p_version_ids);

  return query
    select v.id         as version_id,
           v.bucket,
           v.storage_path,
           d.task_id
      from public.deliverable_versions v
      join public.deliverables d on d.id = v.deliverable_id
     where v.id = any (p_version_ids)
       and v.revocato_gdpr = true;
end $$;

revoke all on function public.revoca_video_on_screen(uuid[]) from public;
grant execute on function public.revoca_video_on_screen(uuid[]) to authenticated;
