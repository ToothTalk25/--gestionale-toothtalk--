-- =====================================================================
-- 0028_consensi.sql — consenso GDPR (privacy e cookie)
-- =====================================================================
-- Il GDPR chiede che il consenso sia "dimostrabile": chi, quando, quale
-- versione. Si registra qui ogni accettazione, in modo append-only:
-- ogni riga resta e non si cancella.
--
--  tipo     = 'privacy' | 'cookie'
--  versione = la versione dell'informativa accettata (es. '2026-08-10')
-- =====================================================================

create table if not exists public.consensi (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  tipo         text not null check (tipo in ('privacy', 'cookie')),
  versione     text not null,
  accettato_at timestamptz not null default now()
);

create index if not exists idx_consensi_user on public.consensi(user_id, accettato_at desc);

alter table public.consensi enable row level security;

-- Ognuno inserisce il proprio consenso; si legge il proprio (e l'accesso
-- globale per il registro). Nessuna modifica o cancellazione.
drop policy if exists consensi_insert on public.consensi;
create policy consensi_insert on public.consensi
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists consensi_select on public.consensi;
create policy consensi_select on public.consensi
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant insert, select on public.consensi to authenticated;
