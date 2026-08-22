-- =====================================================================
-- 0090_notifica_art82.sql — obbligo di notifica proattiva (Art. 8.2
--                            dell'Accordo Editoriale)
-- =====================================================================
-- L'Art. 8.2 dell'Accordo dice: quando il Collaboratore revoca il
-- consenso a immagine/voce SENZA chiedere anche la rimozione del
-- pubblicato, il Coordinatore deve comunque dargliene atto entro 30
-- giorni, informandolo della facoltà di chiedere la rimozione (Art. 8.3).
--
-- Fino a oggi (vedi 0089_revoca_immagine_voce.sql) questo scattava SOLO
-- se il Collaboratore spuntava "chiedi anche rimozione pubblicato": in
-- quel caso si apre una richieste_rimozione_pubblicato. Se invece NON la
-- spunta, non succedeva nulla — l'obbligo di dargliene atto entro 30
-- giorni restava scritto solo nell'Accordo, senza alcun promemoria nel
-- gestionale che lo faccia effettivamente rispettare.
--
-- Questa migrazione aggiunge una coda separata e leggera: non valuta né
-- decide nulla (quello resta editoriale, manuale), si limita a tracciare
-- la scadenza dei 30 giorni e a offrire un bottone "Notifica" che manda
-- l'email dovuta e marca la scadenza come evasa.
-- =====================================================================

create table if not exists public.notifiche_dovute_art82 (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete restrict,
  revocato_at     timestamptz not null default now(),
  scade_at        timestamptz not null default (now() + interval '30 days'),
  notificata_at   timestamptz,
  notificata_da   uuid references public.profiles(id)
);

comment on table public.notifiche_dovute_art82 is
  'Traccia l''obbligo del Coordinatore (Art. 8.2 Accordo Editoriale) di dare '
  'atto al Collaboratore, entro 30 giorni dalla revoca del consenso a '
  'immagine/voce, dell''esistenza di contenuti già pubblicati e della '
  'facoltà di chiederne la rimozione (Art. 8.3). Creata SOLO quando la '
  'revoca non contiene già una richiesta di rimozione (in quel caso si usa '
  'richieste_rimozione_pubblicato, che è l''obbligo più forte).';

create index if not exists idx_notifiche82_user on public.notifiche_dovute_art82(user_id, revocato_at desc);
create index if not exists idx_notifiche82_pendenti on public.notifiche_dovute_art82(scade_at) where notificata_at is null;

alter table public.notifiche_dovute_art82 enable row level security;

drop policy if exists notifiche82_select on public.notifiche_dovute_art82;
create policy notifiche82_select on public.notifiche_dovute_art82
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- La crea il sistema al momento della revoca (stesso client-utente di
-- revocaImmagineVoce, coerente con richieste_rimozione_pubblicato).
drop policy if exists notifiche82_insert on public.notifiche_dovute_art82;
create policy notifiche82_insert on public.notifiche_dovute_art82
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

-- Solo il Titolare la marca come notificata.
drop policy if exists notifiche82_update on public.notifiche_dovute_art82;
create policy notifiche82_update on public.notifiche_dovute_art82
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.notifiche_dovute_art82 to authenticated;

-- Come richieste_rimozione_pubblicato: il fatto originale non si riscrive,
-- si può solo registrare l'avvenuta notifica una volta.
create or replace function public.fn_notifiche82_guard()
returns trigger language plpgsql as $$
begin
  if (new.user_id, new.revocato_at, new.scade_at)
     is distinct from
     (old.user_id, old.revocato_at, old.scade_at)
  then
    raise exception 'Una notifica dovuta non è modificabile nei suoi dati originali'
      using errcode = '42501';
  end if;

  if new.notificata_at is not null and old.notificata_at is null then
    new.notificata_da := auth.uid();
  end if;

  return new;
end $$;

drop trigger if exists trg_notifiche82_guard on public.notifiche_dovute_art82;
create trigger trg_notifiche82_guard
  before update on public.notifiche_dovute_art82
  for each row execute function public.fn_notifiche82_guard();
