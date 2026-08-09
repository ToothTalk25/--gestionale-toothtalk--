-- =====================================================================
-- 0014_elimina_lavorazione.sql — i materiali di lavorazione si eliminano
-- =====================================================================
-- Correzione di impostazione. Fino a qui TUTTO il registro era append-only,
-- ma l'immutabilità serve solo dove c'è qualcosa da dimostrare.
--
--   bucket 'originali'  -> spazio di lavoro condiviso. Video grezzo, bozze,
--                          descrizioni, materiali scartati. Chi partecipa
--                          carica, scarica, corregge, ricarica e ANCHE
--                          elimina: se si sbaglia file lo si toglie e basta.
--                          Nessun valore probatorio, nessuna limitazione.
--
--   bucket 'finali'     -> il pacchetto pubblicabile. Resta intoccabile.
--                          (La rimozione pre-sigillo arriva in 0015.)
--
--   bucket 'revisioni'  -> lavorazioni successive, già liberamente gestibili.
--
-- Le eliminazioni restano tracciate in audit_log: non per limitare nessuno,
-- ma perché in uno spazio condiviso è utile sapere chi ha tolto cosa.
-- =====================================================================

-- Il divieto di cancellazione si restringe al solo archivio pubblicabile.
create or replace function public.fn_versions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.bucket = 'finali' then
      raise exception 'I file del video completo non si eliminano'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.bucket = 'finali' and old.origin = 'originale' then
    raise exception 'File del video completo depositato il %: immutabile', old.uploaded_at
      using errcode = '42501';
  end if;

  -- I dati probatori non si riscrivono mai, in nessun archivio: si può
  -- solo aggiungere una nuova versione o eliminare quella sbagliata.
  if (new.sha256, new.storage_path, new.record_hash, new.prev_record_hash,
      new.uploaded_by, new.uploaded_at, new.version_no, new.origin, new.deliverable_id)
     is distinct from
     (old.sha256, old.storage_path, old.record_hash, old.prev_record_hash,
      old.uploaded_by, old.uploaded_at, old.version_no, old.origin, old.deliverable_id)
  then
    raise exception 'I dati di identificazione di un file non sono modificabili'
      using errcode = '42501';
  end if;

  return new;
end $$;

-- Traccia di chi elimina cosa (informativa, non blocca).
create or replace function public.fn_log_eliminazione_versione()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_polo uuid;
begin
  v_polo := public.polo_of_deliverable(old.deliverable_id);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (
    auth.uid(),
    case when public.is_admin() then 'admin' else 'member' end::public.user_role,
    'eliminazione_file_lavorazione',
    'deliverable_version',
    old.id,
    v_polo,
    jsonb_build_object(
      'file_name', old.file_name,
      'bucket', old.bucket,
      'sha256', old.sha256,
      'storage_path', old.storage_path
    )
  );
  return old;
end $$;

drop trigger if exists trg_log_eliminazione_versione on public.deliverable_versions;
create trigger trg_log_eliminazione_versione
  before delete on public.deliverable_versions
  for each row execute function public.fn_log_eliminazione_versione();

-- ----------------------------------------------------------------- RLS

drop policy if exists versions_delete_lavorazione on public.deliverable_versions;
create policy versions_delete_lavorazione on public.deliverable_versions
  for delete to authenticated
  using (
    bucket <> 'finali'
    and (
      public.is_admin()
      or public.is_member_of(public.polo_of_deliverable(deliverable_id))
    )
  );

grant delete on public.deliverable_versions to authenticated;

-- --------------------------------------------------------------- storage

drop policy if exists originali_delete on storage.objects;
create policy originali_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'originali'
    and (
      public.is_admin()
      or public.is_member_of(public.storage_polo_id(name))
    )
  );
