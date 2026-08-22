-- =====================================================================
-- 0097_richieste_eliminazione_grezzo.sql — revisione MANUALE del grezzo
-- =====================================================================
-- Accordo Art. 7.3/7.4/8.2 (già corretti): la cancellazione del materiale
-- grezzo non pubblicato alla revoca del consenso è SEMPRE manuale, mai
-- automatica. Il motivo è strutturale: il sistema registra chi ha caricato
-- un file (uploaded_by), non chi vi compare. Una cancellazione automatica
-- basata sull'uploader eliminerebbe anche materiale che ritrae terzi che
-- non hanno revocato nulla (es. un girato caricato da Luca che ritrae
-- anche Laura).
--
-- Questa tabella traccia l'obbligo del Coordinatore: quando un Collaboratore
-- revoca il consenso a immagine/voce, si apre una richiesta con scadenza
-- 30 giorni; il Coordinatore individua A OCCHIO quali file ritraggono
-- davvero la persona, li seleziona esplicitamente e solo quelli vengono
-- eliminati. Stesso pattern di richieste_rimozione_pubblicato (0089), ma
-- senza il tipo esito_rimozione (qui l'esito è: quali file eliminati, quali
-- no e perché).
-- =====================================================================

create table if not exists public.richieste_eliminazione_grezzo (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete restrict,
  richiesto_at       timestamptz not null default now(),
  termine_scadenza   timestamptz not null default (now() + interval '30 days'),
  stato              text not null default 'aperta' check (stato in ('aperta', 'risolta')),
  versioni_eliminate uuid[],
  note_coordinatore  text,
  risolta_da         uuid references public.profiles(id),
  risolta_at         timestamptz
);

comment on table public.richieste_eliminazione_grezzo is
  'Richiesta di revisione manuale del materiale grezzo (video_grezzo/audio) '
  'da eliminare alla revoca del consenso a immagine/voce (Accordo Art. 7.4). '
  'La cancellazione NON è automatica: il Coordinatore individua i file che '
  'ritraggono davvero la persona e li seleziona esplicitamente. '
  'richiesto_at/termine_scadenza = data certa e termine dei 30 giorni.';

create index if not exists idx_elim_grezzo_user on public.richieste_eliminazione_grezzo(user_id, richiesto_at desc);
create index if not exists idx_elim_grezzo_pendenti on public.richieste_eliminazione_grezzo(stato, termine_scadenza);

alter table public.richieste_eliminazione_grezzo enable row level security;

drop policy if exists elim_grezzo_select on public.richieste_eliminazione_grezzo;
create policy elim_grezzo_select on public.richieste_eliminazione_grezzo
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists elim_grezzo_insert on public.richieste_eliminazione_grezzo;
create policy elim_grezzo_insert on public.richieste_eliminazione_grezzo
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

-- La chiude solo il Titolare (individuazione ed eliminazione manuale).
drop policy if exists elim_grezzo_update on public.richieste_eliminazione_grezzo;
create policy elim_grezzo_update on public.richieste_eliminazione_grezzo
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.richieste_eliminazione_grezzo to authenticated;
revoke delete on public.richieste_eliminazione_grezzo from authenticated;

-- Trigger guard: i dati originali non si riscrivono; alla chiusura si
-- valorizza risolta_at/risolta_da con auth.uid() (l'admin loggato).
create or replace function public.fn_eliminazione_grezzo_guard()
returns trigger language plpgsql as $$
begin
  if (new.user_id, new.richiesto_at, new.termine_scadenza)
     is distinct from
     (old.user_id, old.richiesto_at, old.termine_scadenza)
  then
    raise exception 'Una richiesta di eliminazione grezzo non è modificabile nei suoi dati originali'
      using errcode = '42501';
  end if;

  if new.stato = 'risolta' and old.stato = 'aperta' then
    new.risolta_at := now();
    new.risolta_da := auth.uid();
  end if;

  return new;
end $$;

drop trigger if exists trg_eliminazione_grezzo_guard on public.richieste_eliminazione_grezzo;
create trigger trg_eliminazione_grezzo_guard
  before update on public.richieste_eliminazione_grezzo
  for each row execute function public.fn_eliminazione_grezzo_guard();
