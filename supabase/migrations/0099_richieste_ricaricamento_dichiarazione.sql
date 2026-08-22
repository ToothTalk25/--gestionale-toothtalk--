-- =====================================================================
-- 0099_richieste_ricaricamento_dichiarazione.sql — errore di caricamento
--                                              del video di dichiarazione
-- =====================================================================
-- Protocollo Art. 4.1 (video di dichiarazione): il file si carica
-- direttamente nel pacchetto da sigillare, è immutabile e non rimovibile
-- da chi lo ha depositato. Se chi ha caricato si è sbagliato, serve una
-- via controllata: un bottone "Segnala errore" che apre una richiesta nel
-- "registro richieste" del Coordinatore; il Coordinatore valuta, libera il
-- campo (rimuovendo il riferimento e cancellando il vecchio file) e il
-- Collaboratore può ricaricare quello corretto.
-- =====================================================================

create table if not exists public.richieste_ricaricamento_dichiarazione (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict,
  pacchetto_id  uuid not null references public.pacchetti_video(id) on delete cascade,
  motivo        text,
  stato         text not null default 'aperta' check (stato in ('aperta', 'risolta')),
  creato_at     timestamptz not null default now(),
  risolta_da    uuid references public.profiles(id),
  risolta_at    timestamptz
);

comment on table public.richieste_ricaricamento_dichiarazione is
  'Segnalazione di errore sul video di dichiarazione depositato nel pacchetto '
  '(Protocollo Art. 4.1). Il depositante segnala; il Coordinatore valuta e '
  'libera il campo; poi si può ricaricare il video corretto.';

create index if not exists idx_ricar_dich_user on public.richieste_ricaricamento_dichiarazione(user_id, creato_at desc);
create index if not exists idx_ricar_dich_pendenti on public.richieste_ricaricamento_dichiarazione(stato, creato_at);

alter table public.richieste_ricaricamento_dichiarazione enable row level security;

drop policy if exists ricar_dich_select on public.richieste_ricaricamento_dichiarazione;
create policy ricar_dich_select on public.richieste_ricaricamento_dichiarazione
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists ricar_dich_insert on public.richieste_ricaricamento_dichiarazione;
create policy ricar_dich_insert on public.richieste_ricaricamento_dichiarazione
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

drop policy if exists ricar_dich_update on public.richieste_ricaricamento_dichiarazione;
create policy ricar_dich_update on public.richieste_ricaricamento_dichiarazione
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.richieste_ricaricamento_dichiarazione to authenticated;
revoke delete on public.richieste_ricaricamento_dichiarazione from authenticated;

create or replace function public.fn_ricar_dich_guard()
returns trigger language plpgsql as $$
begin
  if (new.user_id, new.pacchetto_id, new.creato_at) is distinct from (old.user_id, old.pacchetto_id, old.creato_at) then
    raise exception 'Una richiesta di ricaricamento non è modificabile nei suoi dati originali'
      using errcode = '42501';
  end if;
  if new.stato = 'risolta' and old.stato = 'aperta' then
    new.risolta_at := now();
    new.risolta_da := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_ricar_dich_guard on public.richieste_ricaricamento_dichiarazione;
create trigger trg_ricar_dich_guard
  before update on public.richieste_ricaricamento_dichiarazione
  for each row execute function public.fn_ricar_dich_guard();
