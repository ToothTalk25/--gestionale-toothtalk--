-- =====================================================================
-- 0015_rimuovi_pre_sigillo.sql — si corregge finché non si sigilla
-- =====================================================================
-- Il video completo si compone a tentativi: si carica il montaggio
-- sbagliato, ci si accorge, si sostituisce. Finché il pacchetto è in
-- BOZZA tutto è rimuovibile.
--
-- Nell'istante del sigillo la porta si chiude e non si riapre: da lì in
-- poi nessuno può eliminare nulla, perché è esattamente quel contenuto ad
-- essere spedito via PEC. E anche se qualcuno riuscisse a manomettere il
-- database, la ricevuta PEC resta fuori dalla sua portata: è depositata
-- presso il gestore e nelle caselle di chi l'ha ricevuta.
--
-- Tre difese sovrapposte, non una:
--   1. il trigger qui sotto rifiuta la DELETE su un file già sigillato;
--   2. il vincolo di chiave esterna (on delete restrict) impedisce di
--      cancellare un file ancora agganciato al pacchetto;
--   3. fn_elementi_congelati impedisce di sganciarlo dopo il sigillo.
-- =====================================================================

create or replace function public.fn_versions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.bucket = 'finali' and exists (
      select 1
      from public.pacchetto_elementi pe
      join public.pacchetti_video p on p.id = pe.pacchetto_id
      where pe.version_id = old.id and p.stato <> 'bozza'
    ) then
      raise exception 'Video completo già sigillato: i file non si eliminano più'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.bucket = 'finali' and old.origin = 'originale' then
    raise exception 'File del video completo depositato il %: immutabile', old.uploaded_at
      using errcode = '42501';
  end if;

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

-- Il file è agganciato a un pacchetto già sigillato?
create or replace function public.file_finale_sigillato(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.deliverable_versions v
    join public.pacchetto_elementi pe on pe.version_id = v.id
    join public.pacchetti_video p on p.id = pe.pacchetto_id
    where v.storage_path = p_name and p.stato <> 'bozza'
  );
$$;

-- ----------------------------------------------------------------- RLS

drop policy if exists versions_delete_lavorazione on public.deliverable_versions;
drop policy if exists versions_delete on public.deliverable_versions;
create policy versions_delete on public.deliverable_versions
  for delete to authenticated
  using (
    (
      public.is_admin()
      or public.is_member_of(public.polo_of_deliverable(deliverable_id))
    )
    and (
      bucket <> 'finali'
      or not exists (
        select 1
        from public.pacchetto_elementi pe
        join public.pacchetti_video p on p.id = pe.pacchetto_id
        where pe.version_id = id and p.stato <> 'bozza'
      )
    )
  );

-- Sganciare un elemento dal pacchetto: consentito solo in bozza, già
-- imposto da fn_elementi_congelati. Qui si concede il permesso di base.
drop policy if exists elementi_delete on public.pacchetto_elementi;
create policy elementi_delete on public.pacchetto_elementi
  for delete to authenticated
  using (
    exists (
      select 1 from public.pacchetti_video p
      where p.id = pacchetto_id
        and p.stato = 'bozza'
        and (
          public.is_admin()
          or public.is_member_of(public.polo_of_task(p.task_id))
        )
    )
  );

grant delete on public.pacchetto_elementi to authenticated;

-- --------------------------------------------------------------- storage

drop policy if exists finali_delete on storage.objects;
create policy finali_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'finali'
    and (
      public.is_admin()
      or public.is_member_of(public.storage_polo_id(name))
    )
    and not public.file_finale_sigillato(name)
  );
