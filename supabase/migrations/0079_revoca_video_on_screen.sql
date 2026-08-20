-- =====================================================================
-- 0079_revoca_video_on_screen.sql — RPC di revoca consenso (Art. 17 GDPR)
-- =====================================================================
-- Flusso "Termina Collaborazione" per un partecipante on-screen:
--  1. trova tutte le consegne ORIGINALI caricate dal soggetto (uploaded_by)
--     il cui deliverable è video grezzo o audio;
--  2. le marca come revocate (revocato_gdpr=true, revocato_at=now())
--     — l'unica transizione ammessa dal trigger append-only (0078);
--  3. porta le task collegate allo stato archived_due_to_revocation;
--  4. restituisce (version_id, bucket, storage_path, task_id) così il
--     livello applicativo sa quali FILE FISICI eliminare dallo storage.
--
-- La funzione è SECURITY DEFINER (esegue come proprietario, come
-- is_admin()/archivia_file_finale) ma VERIFICA prima che il chiamante sia
-- il Titolare: mai accessibile da un membro normale.
--
-- I byte fisici vengono eliminati dallo storage dal livello TypeScript
-- (Supabase Storage API): la riga e lo SHA256 restano come prova legale.
-- =====================================================================

create or replace function public.revoca_video_on_screen(p_user uuid)
returns table (
  version_id   uuid,
  bucket       text,
  storage_path text,
  task_id      uuid
)
language plpgsql security definer set search_path = public as $$
begin
  -- Solo il Titolare (admin) può eseguire la revoca.
  if not public.is_admin() then
    raise exception 'Operazione riservata al Titolare' using errcode = '42501';
  end if;

  -- Materializza PRIMA le righe da toccare (il WITH di una CTE è scoped a
  -- una singola statement, quindi qui si usa una tabella temporanea).
  drop table if exists tmp_revoca_on_commit_drop;
  create temp table tmp_revoca_on_commit_drop on commit drop as
    select v.id         as version_id,
           v.bucket,
           v.storage_path,
           d.task_id
      from public.deliverable_versions v
      join public.deliverables d on d.id = v.deliverable_id
     where v.uploaded_by  = p_user
       and v.origin       = 'originale'
       and v.revocato_gdpr = false
       and d.kind in ('video_grezzo', 'audio');

  -- 1. Marca le versioni come revocate (one-way, unica modifica ammessa).
  update public.deliverable_versions v
     set revocato_gdpr = true,
         revocato_at   = now()
    from tmp_revoca_on_commit_drop t
   where v.id = t.version_id;

  -- 2. Archivia le task collegate (status admin-only, via fn_tasks_guard
  --    la whitelist dei non-admin resta chiusa; qui l'admin passa).
  update public.tasks tk
     set status = 'archived_due_to_revocation'
   where tk.id in (select distinct t.task_id from tmp_revoca_on_commit_drop t);

  -- 3. Restituisce le righe toccate: il livello TypeScript cancellerà i
  --    file fisici corrispondenti dallo storage (best-effort).
  return query
    select t.version_id, t.bucket, t.storage_path, t.task_id
      from tmp_revoca_on_commit_drop t;
end $$;

grant execute on function public.revoca_video_on_screen(uuid) to authenticated;
revoke all on function public.revoca_video_on_screen(uuid) from public;
-- Il default Supabase concede EXECUTE anche ad anon: lo togliamo esplicitamente.
-- (La funzione verifica comunque is_admin() internamente; questo è un secondo
-- strato, perché l'endpoint pubblico non deve nemmeno esporre la firma.)
revoke execute on function public.revoca_video_on_screen(uuid) from anon;
