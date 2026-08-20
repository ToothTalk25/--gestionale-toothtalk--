-- =====================================================================
-- 0085_richieste_recesso.sql — comunicazioni di recesso tracciate
-- =====================================================================
-- Art. 8 dell'Accordo: il Collaboratore può recedere con un preavviso di
-- 30 giorni. Per avere DATA CERTA del recesso senza dipendere dall'invio
-- di email/PEC, la richiesta viene registrata qui con timestamp immutabile
-- (stesso principio dell'audit_log: append-only, mai modificata né
-- cancellata). Da questa data decorre il preavviso.
-- =====================================================================

create table if not exists public.richieste_recesso (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  motivazione  text,
  richiesto_at timestamptz not null default now(),
  creato_at    timestamptz not null default now()
);

comment on table public.richieste_recesso is
  'Recesso del Collaboratore (Art. 8 dell''Accordo). Append-only: il '
  'timestamp richiesto_at è la data certa da cui decorrono i 30 giorni '
  'di preavviso.';

create index if not exists idx_recesso_user on public.richieste_recesso(user_id, richiesto_at desc);

alter table public.richieste_recesso enable row level security;

-- Chi la chiede la può leggere; l'admin vede tutto.
drop policy if exists recesso_select_self on public.richieste_recesso;
create policy recesso_select_self on public.richieste_recesso
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- Inserimento: solo il collaboratore stesso (o admin).
drop policy if exists recesso_insert on public.richieste_recesso;
create policy recesso_insert on public.richieste_recesso
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

-- Append-only: nessun update o delete (l'assenza di policy lo vieta).
revoke update, delete on public.richieste_recesso from authenticated;
