-- =====================================================================
-- 0131_collaboratore_tecnico.sql — anagrafica, registro accessi e rinnovo
-- del Collaboratore Tecnico (Documento 5), Opzione B: nessun profilo
-- applicativo (niente profiles.role), solo dati gestiti dall'accesso
-- globale. Vedi note-legali/PROMPT_claude_code_rinnovo_tecnico_invio_automatico.md
-- e note-legali/PROMPT_claude_code_pagina_admin_collaboratore_tecnico.md.
-- =====================================================================

create table if not exists public.collaboratori_tecnici (
  id                          uuid primary key default gen_random_uuid(),
  nome                        text not null,
  contatto                    text not null, -- email o PEC
  documento5_sottoscritto_il  date,
  accordo_sha256              text,          -- impronta del Documento 5 firmato, da riportare a mano sul 5bis
  accordo_scadenza            date,
  rinnovo_path                text,
  rinnovo_sha256              text,
  rinnovo_caricato_at         timestamptz,
  rinnovo_approvato_admin_at  timestamptz,
  rinnovo_approvato_da        uuid references public.profiles(id),
  attivo                      boolean not null default true,
  created_by                  uuid references public.profiles(id),
  created_at                  timestamptz not null default now()
);

comment on table public.collaboratori_tecnici is
  'Collaboratori Tecnici (Documento 5): non hanno un profilo applicativo '
  '(Opzione B) — anagrafica, accordo e rinnovo gestiti qui direttamente '
  'dall''accesso globale, senza login né RLS "utente proprietario".';

-- Registro degli accessi: versione digitale dell'Allegato 1 del Documento 5
-- (sistema, livello concesso, data concessione, data revoca), invece di un
-- file Word compilato a mano — sempre consultabile e verificabile.
create table if not exists public.collaboratori_tecnici_accessi (
  id                        uuid primary key default gen_random_uuid(),
  collaboratore_tecnico_id  uuid not null references public.collaboratori_tecnici(id) on delete cascade,
  sistema                   text not null,
  livello                   text not null,
  concesso_il               date not null default current_date,
  revocato_il               date,
  note                      text,
  created_by                uuid references public.profiles(id),
  created_at                timestamptz not null default now()
);

comment on table public.collaboratori_tecnici_accessi is
  'Registro degli accessi ai sistemi concessi a un Collaboratore Tecnico — '
  'Allegato 1 del Documento 5 in forma digitale.';

create index if not exists idx_collaboratori_tecnici_accessi_collaboratore
  on public.collaboratori_tecnici_accessi(collaboratore_tecnico_id);

-- ------------------------------------------------------------------ RLS
-- Nessun utente applicativo corrisponde a queste righe (Opzione B): solo
-- l'accesso globale legge e scrive, nessuna policy "utente proprietario".
alter table public.collaboratori_tecnici enable row level security;
alter table public.collaboratori_tecnici_accessi enable row level security;

drop policy if exists collaboratori_tecnici_admin_all on public.collaboratori_tecnici;
create policy collaboratori_tecnici_admin_all on public.collaboratori_tecnici
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists collaboratori_tecnici_accessi_admin_all on public.collaboratori_tecnici_accessi;
create policy collaboratori_tecnici_accessi_admin_all on public.collaboratori_tecnici_accessi
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.collaboratori_tecnici to authenticated;
grant select, insert, update, delete on public.collaboratori_tecnici_accessi to authenticated;
