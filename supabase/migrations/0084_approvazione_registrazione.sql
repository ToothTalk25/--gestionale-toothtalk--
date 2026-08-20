-- =====================================================================
-- 0084_approvazione_registrazione.sql — flusso approvazione admin
-- =====================================================================
-- La registrazione crea l'account INATTIVO (attivo=false): la persona non
-- può accedere finché l'Admin non la approva. L'approvazione registra
-- quando e da chi è avvenuta (approvato_at/approvato_da) e, al momento
-- dell'approvazione, l'Admin conferma/corregge il flag on_screen.
--
-- SICUREZZA: profiles ha RLS (profiles_update_self) che permette a
-- QUALSIASI utente autenticato di aggiornare la propria riga. L'unica
-- protezione sulle colonne sensibili è il trigger fn_protect_profile
-- (BEFORE UPDATE). Senza estenderlo, un utente con attivo=false potrebbe
-- auto-attivarsi chiamando direttamente il client Supabase dal browser
-- (bypassando la UI). Quindi attivo/approvato_at/approvato_da vengono
-- protetti nello stesso trigger, come già role e on_screen.
-- =====================================================================

alter table public.profiles
  add column if not exists approvato_at timestamptz,
  add column if not exists approvato_da uuid references public.profiles(id);

comment on column public.profiles.approvato_at is
  'Quando l''Admin ha approvato la registrazione. null = richiesta in attesa '
  '(se attivo=false) o utente creato prima di questo meccanismo.';
comment on column public.profiles.approvato_da is
  'Admin che ha approvato la registrazione.';

-- Estende la guardia esistente (0001/0076): come role e on_screen, anche
-- attivo/approvato_at/approvato_da sono modificabili SOLO da admin o
-- service_role — mai dall'interessato, altrimenti l'RLS
-- "profiles_update_self" permetterebbe l'auto-approvazione.
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
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  return new;
end $$;
