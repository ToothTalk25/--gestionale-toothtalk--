-- =====================================================================
-- 0076_profiles_on_screen.sql — flag "appare in video" (Front Man)
-- =====================================================================
-- Distingue i partecipanti che appaiono in video ("on-screen" / Front Man)
-- da quelli che lavorano solo al backstage (script, copertine, montaggio).
-- La distinzione serve alla revoca del consenso (Art. 17 GDPR): per chi
-- appare in video, l'immagine e la voce sono dati personali/biometrici e la
-- revoca è incondizionata -> i video grezzi vanno purgati dallo storage.
-- Il flag è modificabile SOLO dal Titolare (admin) o dal service_role,
-- esattamente come il ruolo: mai dall'interessato, per evitare che un
-- membro si auto-assegni o si auto-tolga lo status.
-- =====================================================================

alter table public.profiles
  add column if not exists on_screen boolean not null default false;

comment on column public.profiles.on_screen is
  'Il partecipante appare in video (Front Man). Se true, una eventuale '
  'revoca del consenso (Art. 17 GDPR) comporta la purga dei video/audio '
  'grezzi che lo ritraggono, mantenendo intatto il lavoro di backstage. '
  'Modificabile solo dal Titolare o dal service_role.';

-- Estende la guardia esistente (0001_schema.sql): come per `role`, anche
-- `on_screen` può essere cambiato solo da is_admin() o is_service_role().
create or replace function public.fn_protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare il ruolo di un utente' using errcode = '42501';
  end if;
  if new.on_screen is distinct from old.on_screen and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare lo status on-screen di un utente' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  return new;
end $$;
