-- =====================================================================
-- 0120_domande_supporto.sql — FAQ/assistenza collaboratori + push admin
-- =====================================================================
-- Un collaboratore scrive una domanda (processo editoriale o
-- malfunzionamento); l'IA (Gemini) la classifica e, se tecnica, prepara
-- una bozza di risposta che il Coordinatore rivede e invia (mai
-- pubblicata automaticamente — vedi src/app/actions-supporto.ts). Le
-- domande "altro" restano semplicemente in attesa di una risposta scritta
-- dal Coordinatore. Nessuna cancellazione prevista: è uno storico
-- consultabile, non un registro con valore legale come deliverable_versions
-- o audit_log, quindi niente trigger append-only qui.

create table if not exists public.domande_supporto (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  domanda            text not null,
  creato_at          timestamptz not null default now(),
  categoria_ia       text check (categoria_ia in ('tecnica', 'altro')),
  bozza_risposta_ia  text,
  bozza_generata_at  timestamptz,
  risposta           text,
  risposto_da        uuid references public.profiles(id) on delete set null,
  risposto_at        timestamptz
);

alter table public.domande_supporto enable row level security;

drop policy if exists domande_supporto_admin on public.domande_supporto;
create policy domande_supporto_admin on public.domande_supporto
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Ogni collaboratore vede e crea solo le proprie domande; non può
-- modificarle (una correzione si fa scrivendo una domanda nuova) né
-- vedere quelle altrui.
drop policy if exists domande_supporto_proprie_select on public.domande_supporto;
create policy domande_supporto_proprie_select on public.domande_supporto
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists domande_supporto_proprie_insert on public.domande_supporto;
create policy domande_supporto_proprie_insert on public.domande_supporto
  for insert to authenticated
  with check (user_id = auth.uid());

grant select, insert, update on public.domande_supporto to authenticated;

-- ---------------------------------------------------------------------
-- Iscrizioni Web Push: un dispositivo per riga, un utente può averne più
-- di uno (telefono + computer). Generica (non solo per l'admin): la
-- sezione Domande la usa per notificare il Coordinatore, ma la tabella
-- non presume chi la userà in futuro.
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  chiave_p256dh text not null,
  chiave_auth   text not null,
  creato_at     timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_proprie on public.push_subscriptions;
create policy push_subscriptions_proprie on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, delete on public.push_subscriptions to authenticated;
