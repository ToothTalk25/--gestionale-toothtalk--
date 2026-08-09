-- =====================================================================
-- 0002_rls.sql : Row Level Security
-- =====================================================================
-- Matrice dei permessi (ruolo globale × tabella):
--
--                       MEMBRO del polo X              ADMIN (Titolare)
-- poli                  read (i propri)                read/write tutti
-- profiles              read sé + colleghi di polo     read/write tutti
-- memberships           read (i propri poli)           read/write tutti
-- tasks                 read/insert/update (polo X,    tutto, su ogni polo
--                       solo se non locked, stati
--                       limitati)
-- deliverables          read/insert (polo X)           tutto
-- deliverable_versions  read (polo X)                  read tutti
--                       insert SOLO origin=originale   insert origin=admin_edit
--                       update/delete: MAI             update/delete: MAI
-- audit_log             read (polo X), insert          read tutto, insert
--
-- Nota: l'assenza di una policy equivale al divieto. Le UPDATE/DELETE su
-- deliverable_versions non hanno policy per NESSUN ruolo: è il divieto
-- strutturale che rende l'archivio una prova.
-- =====================================================================

alter table public.poli                 enable row level security;
alter table public.profiles             enable row level security;
alter table public.memberships          enable row level security;
alter table public.tasks                enable row level security;
alter table public.deliverables         enable row level security;
alter table public.deliverable_versions enable row level security;
alter table public.task_status_history  enable row level security;
alter table public.audit_log            enable row level security;

-- Helper anti-ricorsione (SECURITY DEFINER = non riattiva le policy).
create or replace function public.shares_polo_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.memberships a
    join public.memberships b on b.polo_id = a.polo_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------- poli
drop policy if exists poli_select on public.poli;
create policy poli_select on public.poli
  for select to authenticated
  using (public.is_admin() or public.is_member_of(id));

drop policy if exists poli_admin_all on public.poli;
create policy poli_admin_all on public.poli
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------ profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.shares_polo_with(id));

-- Aggiornamento del proprio profilo: il cambio di "role" è comunque
-- intercettato dal trigger fn_protect_profile.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------- memberships
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (public.is_admin() or public.is_member_of(polo_id));

-- Solo l'Admin compone i gruppi: un membro non può aggiungersi a un polo
-- né aggiungerci qualcun altro.
drop policy if exists memberships_admin_all on public.memberships;
create policy memberships_admin_all on public.memberships
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------------- tasks
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.can_read_polo(polo_id));

-- Modello piatto: QUALSIASI membro del polo può creare una task del polo.
drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member on public.tasks
  for insert to authenticated
  with check (public.is_member_of(polo_id) and created_by = auth.uid() and not locked);

drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member on public.tasks
  for update to authenticated
  using (public.is_member_of(polo_id) and not locked)
  with check (public.is_member_of(polo_id));

drop policy if exists tasks_admin_all on public.tasks;
create policy tasks_admin_all on public.tasks
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------------------- deliverables
drop policy if exists deliverables_select on public.deliverables;
create policy deliverables_select on public.deliverables
  for select to authenticated
  using (public.can_read_polo(public.polo_of_task(task_id)));

drop policy if exists deliverables_insert_member on public.deliverables;
create policy deliverables_insert_member on public.deliverables
  for insert to authenticated
  with check (
    public.is_member_of(public.polo_of_task(task_id))
    and public.task_aperta(task_id)
  );

drop policy if exists deliverables_admin_all on public.deliverables;
create policy deliverables_admin_all on public.deliverables
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------ deliverable_versions
drop policy if exists versions_select on public.deliverable_versions;
create policy versions_select on public.deliverable_versions
  for select to authenticated
  using (public.can_read_polo(public.polo_of_deliverable(deliverable_id)));

-- Il membro deposita SOLO consegne originali, a proprio nome.
drop policy if exists versions_insert_originale on public.deliverable_versions;
create policy versions_insert_originale on public.deliverable_versions
  for insert to authenticated
  with check (
    origin = 'originale'
    and bucket = 'originali'
    and uploaded_by = auth.uid()
    and public.is_member_of(public.polo_of_deliverable(deliverable_id))
    and public.task_aperta_per_deliverable(deliverable_id)
  );

-- L'Admin deposita SOLO versioni derivate, in un bucket separato.
-- Non può inserire un "originale": non può fabbricare una consegna a nome
-- del team, e non può sovrascrivere quella vera.
drop policy if exists versions_insert_admin on public.deliverable_versions;
create policy versions_insert_admin on public.deliverable_versions
  for insert to authenticated
  with check (
    origin = 'admin_edit'
    and bucket = 'revisioni'
    and uploaded_by = auth.uid()
    and public.is_admin()
  );

-- NESSUNA policy di UPDATE o DELETE. Volutamente. Per nessuno.

-- -------------------------------------------------- task_status_history
drop policy if exists status_history_select on public.task_status_history;
create policy status_history_select on public.task_status_history
  for select to authenticated
  using (public.can_read_polo(public.polo_of_task(task_id)));

-- ----------------------------------------------------------- audit_log
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log
  for select to authenticated
  using (public.is_admin() or public.is_member_of(polo_id));

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor = auth.uid());

-- ------------------------------------------------------------- grants
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Nessun DELETE concesso al ruolo authenticated: la cancellazione passa
-- esclusivamente da operazioni amministrative fuori applicazione.
revoke delete on all tables in schema public from authenticated;
