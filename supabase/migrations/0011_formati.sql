-- =====================================================================
-- 0011_formati.sql — formati dei contenuti e liberatoria condizionale
-- =====================================================================
-- I formati sono una TABELLA, non un enum: ogni formato porta con sé
-- l'attributo richiede_liberatoria, e nuovi formati (o la revisione di uno
-- esistente) si aggiungono con un insert/update, senza toccare il codice.
--
-- La liberatoria compare fra i materiali di lavorazione di un progetto
-- SOLO se il formato scelto la richiede: un progetto "ToothTest" non la
-- mostra, un progetto "Parola al Professionista" sì. Il criterio è "il
-- formato prevede la partecipazione di una persona esterna al progetto".
-- =====================================================================

create table if not exists public.formati (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  nome                  text not null,
  richiede_liberatoria  boolean not null default false,
  attivo                boolean not null default true,
  created_at            timestamptz not null default now()
);

comment on table public.formati is
  'Formati dei contenuti ToothTalk. richiede_liberatoria=true quando il '
  'formato prevede tipicamente la partecipazione di una persona esterna '
  'al progetto (es. intervista a un professionista): in quel caso la '
  'liberatoria privacy/immagine compare fra i materiali richiesti.';

alter table public.tasks
  add column if not exists formato_id uuid references public.formati(id);

-- ------------------------------------------------------------------ RLS
alter table public.formati enable row level security;

-- Tutti leggono l'elenco (serve per scegliere il formato in fase di
-- creazione progetto); solo chi ha accesso globale lo amministra.
drop policy if exists formati_select on public.formati;
create policy formati_select on public.formati
  for select to authenticated
  using (true);

drop policy if exists formati_admin_all on public.formati;
create policy formati_admin_all on public.formati
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.formati to authenticated;
grant insert, update, delete on public.formati to authenticated;

-- --------------------------------------------------------------- seed
-- Classificazione iniziale ragionata sui template esistenti, DA CONFERMARE:
-- solo "Parola al Professionista" è certo (intervista a persona reale).
insert into public.formati (slug, nome, richiede_liberatoria) values
  ('parola_professionista', 'Parola al Professionista', true),
  ('eventi',                'Eventi',                    true),
  ('orientamento',          'Orientamento',               true),
  ('anatomia_scienza',      'Anatomia & Scienza',         false),
  ('toothtalk',             'ToothTalk',                  false),
  ('toothtest',             'ToothTest',                  false),
  ('pillole_igiene',        'Pillole di Igiene Dentale',  false)
on conflict (slug) do nothing;
