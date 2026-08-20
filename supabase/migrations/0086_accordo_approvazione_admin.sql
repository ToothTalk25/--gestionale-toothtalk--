-- =====================================================================
-- 0086_accordo_approvazione_admin.sql — blocco accesso progetti finché
--                                      l'accordo non è completo
-- =====================================================================
-- Quattro condizioni, TUTTE necessarie, prima che un Collaboratore possa
-- accedere ai progetti:
--   1. accordo caricato (accordo_path)
--   2. spunta "ho letto e compreso" (accordo_letto_confermato)
--   3. verifica IA = 'ok' (accordo_verificato)  [con confronto col modello]
--   4. approvazione MANUALE del Titolare (accordo_approvato_admin_at)
--
-- Le prime due esistono già. Questa migrazione aggiunge la quarta
-- (approvazione manuale) e protegge il nuovo campo nel trigger come gli
-- altri campi sensibili.
-- =====================================================================

alter table public.profiles
  add column if not exists accordo_approvato_admin_at timestamptz,
  add column if not exists accordo_approvato_da uuid references public.profiles(id);

comment on column public.profiles.accordo_approvato_admin_at is
  'Quando il Titolare ha approvato manualmente l''accordo caricato '
  '(oltre alla verifica IA). null = in attesa. Necessario, insieme ad '
  'accordo_path/accordo_letto_confermato/accordo_verificato=ok, per '
  'sbloccare l''accesso ai progetti (vedi layout.tsx).';
comment on column public.profiles.accordo_approvato_da is
  'Titolare che ha approvato manualmente l''accordo.';

-- Backfill: chi è GIÀ attivo oggi (prima di questa modifica) viene
-- approvato automaticamente — il blocco vale solo per le nuove
-- approvazioni da questo momento in poi, non retroattivo su chi
-- lavora già regolarmente.
update public.profiles
  set accordo_approvato_admin_at = now()
  where attivo = true and role <> 'admin' and accordo_approvato_admin_at is null;

-- Estende la guardia esistente: come role/on_screen/attivo/approvato_*,
-- anche l'approvazione manuale dell'accordo è modificabile SOLO da admin
-- o service_role — mai dall'interessato.
create or replace function public.fn_protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare il ruolo di un utente' using errcode = '42501';
  end if;
  if new.on_screen is distinct from old.on_screen and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare lo status on-screen di un utente' using errcode = '42501';
  end if;
  if new.attivo is distinct from old.attivo and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può attivare/disattivare un account' using errcode = '42501';
  end if;
  if new.approvato_at is distinct from old.approvato_at and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare una registrazione' using errcode = '42501';
  end if;
  if new.approvato_da is distinct from old.approvato_da and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare una registrazione' using errcode = '42501';
  end if;
  if new.accordo_approvato_admin_at is distinct from old.accordo_approvato_admin_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare un accordo' using errcode = '42501';
  end if;
  if new.accordo_approvato_da is distinct from old.accordo_approvato_da
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare un accordo' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  return new;
end $$;
