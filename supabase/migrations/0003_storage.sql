-- =====================================================================
-- 0003_storage.sql : bucket privati e policy sui file
-- =====================================================================
-- Due bucket, non due cartelle: la separazione fisica rende impossibile
-- che una policy sbagliata su un prefisso esponga l'altro archivio.
--
--   originali  -> consegne del team. INSERT dai membri del polo.
--                 UPDATE e DELETE: nessuna policy, per nessuno.
--                 Neanche il Titolare può sovrascrivere o cancellare un file
--                 originale con la propria sessione applicativa.
--   revisioni  -> lavorazioni del Titolare. Solo l'Admin scrive; i membri
--                 leggono (vedono sempre cosa è stato fatto del loro lavoro).
--
-- Convenzione di path OBBLIGATORIA, verificata dalle policy:
--   {polo_id}/{task_id}/{deliverable_id}/{uuid}__{nomefile}
--   ^^^^^^^^ il primo segmento è la chiave di autorizzazione
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('originali', 'originali', false, 5368709120)   -- 5 GB
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit)
values ('revisioni', 'revisioni', false, 5368709120)
on conflict (id) do update set public = false;

-- Ricava il polo dal path e verifica che il path sia ben formato.
create or replace function public.storage_polo_id(p_name text)
returns uuid language sql immutable as $$
  select public.try_uuid((storage.foldername(p_name))[1]);
$$;

create or replace function public.storage_path_valido(p_name text)
returns boolean language sql immutable as $$
  select array_length(storage.foldername(p_name), 1) = 3
     and public.try_uuid((storage.foldername(p_name))[1]) is not null
     and public.try_uuid((storage.foldername(p_name))[2]) is not null
     and public.try_uuid((storage.foldername(p_name))[3]) is not null;
$$;

-- Secondo segmento del path = task_id, usato per rifiutare gli upload su
-- task congelate dal Titolare.
create or replace function public.storage_task_id(p_name text)
returns uuid language sql immutable as $$
  select public.try_uuid((storage.foldername(p_name))[2]);
$$;

-- ----------------------------------------------------- bucket originali

drop policy if exists originali_select on storage.objects;
create policy originali_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'originali'
    and public.can_read_polo(public.storage_polo_id(name))
  );

drop policy if exists originali_insert on storage.objects;
create policy originali_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'originali'
    and public.storage_path_valido(name)
    and public.is_member_of(public.storage_polo_id(name))
    and public.task_aperta(public.storage_task_id(name))
  );

-- >>> NESSUNA policy UPDATE/DELETE sul bucket 'originali'. <<<
-- Conseguenze pratiche:
--  * un membro non può ricaricare sopra il proprio file: può solo depositare
--    una nuova versione, che si affianca alla precedente;
--  * l'Admin, dalla dashboard, non può alterare né rimuovere l'originale;
--  * l'upload deve usare upsert:false (un upsert genererebbe una UPDATE,
--    che verrebbe rifiutata).

-- ----------------------------------------------------- bucket revisioni

drop policy if exists revisioni_select on storage.objects;
create policy revisioni_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'revisioni'
    and public.can_read_polo(public.storage_polo_id(name))
  );

drop policy if exists revisioni_admin_insert on storage.objects;
create policy revisioni_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'revisioni'
    and public.storage_path_valido(name)
    and public.is_admin()
  );

drop policy if exists revisioni_admin_update on storage.objects;
create policy revisioni_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'revisioni' and public.is_admin())
  with check (bucket_id = 'revisioni' and public.is_admin());

drop policy if exists revisioni_admin_delete on storage.objects;
create policy revisioni_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'revisioni' and public.is_admin());
