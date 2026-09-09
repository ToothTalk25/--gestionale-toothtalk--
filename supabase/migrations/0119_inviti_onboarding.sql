-- =====================================================================
-- 0119_inviti_onboarding.sql — link di onboarding con validità 7 giorni
-- =====================================================================
-- Il link che l'admin invia via email a un indirizzo qualsiasi (sezione
-- "Invia link di accesso") non punta più alla homepage nuda, ma a una
-- pagina pubblica dedicata (/benvenuto?token=...) valida solo 7 giorni —
-- stesso pattern token/scadenza già usato per la liberatoria
-- (0042_richieste_liberatoria.sql), qui senza stato "caricata"/"usato":
-- il link resta consultabile più volte finché non scade, non è un'azione
-- singola da tracciare.

create table if not exists public.inviti_onboarding (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  token      text not null unique default encode(gen_random_bytes(24), 'hex'),
  creato_at  timestamptz not null default now(),
  creato_da  uuid references public.profiles(id) on delete set null,
  scade_at   timestamptz not null default (now() + interval '7 days')
);

alter table public.inviti_onboarding enable row level security;

drop policy if exists inviti_onboarding_admin on public.inviti_onboarding;
create policy inviti_onboarding_admin on public.inviti_onboarding
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert on public.inviti_onboarding to authenticated;

/** Verifica se un token è valido (esiste, non scaduto): usata dalla pagina pubblica /benvenuto, nessuna sessione. */
create or replace function public.verifica_token_onboarding(p_token text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.inviti_onboarding
    where token = p_token and scade_at > now()
  );
$$;

grant execute on function public.verifica_token_onboarding(text) to anon, authenticated;
