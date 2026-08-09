-- =====================================================================
-- 0017_richieste_modifica.sql — revisione dei video sigillati
-- =====================================================================
-- Quando un pacchetto è sigillato non si tocca più: è quello il suo valore.
-- Ma un video può comunque avere bisogno di correzioni prima di finire sui
-- social. Le richieste di modifica quindi NON alterano il pacchetto: sono
-- messaggi che vivono a fianco, visibili a chi partecipa al gruppo dentro la
-- piattaforma, senza doversi rincorrere su WhatsApp.
--
-- Se le correzioni sono sostanziali, il pacchetto sigillato viene annullato
-- (resta comunque a registro, con il suo verbale PEC già spedito) e il
-- gruppo ne compone uno nuovo. La storia resta leggibile per intero.
-- =====================================================================

do $$ begin
  create type public.richiesta_stato as enum ('aperta', 'risolta');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Su quale elemento verte la richiesta.
  create type public.ambito_richiesta as enum (
    'video', 'copertina', 'descrizione', 'script', 'generale'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.richieste_modifica (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  pacchetto_id  uuid references public.pacchetti_video(id) on delete set null,
  ambito        public.ambito_richiesta not null default 'generale',
  testo         text not null,
  stato         public.richiesta_stato not null default 'aperta',
  creata_da     uuid references public.profiles(id),
  creata_at     timestamptz not null default now(),
  risolta_da    uuid references public.profiles(id),
  risolta_at    timestamptz,
  nota_risposta text
);

create index if not exists idx_richieste_task on public.richieste_modifica(task_id, creata_at desc);
create index if not exists idx_richieste_stato on public.richieste_modifica(stato);

comment on table public.richieste_modifica is
  'Richieste di correzione su un video già sigillato. Non modificano il '
  'pacchetto, che resta immutabile: sono comunicazioni tracciate.';

-- ----------------------------------------------------------------- RLS

alter table public.richieste_modifica enable row level security;

-- Chi partecipa al gruppo vede le richieste che riguardano i propri progetti.
drop policy if exists richieste_select on public.richieste_modifica;
create policy richieste_select on public.richieste_modifica
  for select to authenticated
  using (public.can_read_polo(public.polo_of_task(task_id)));

-- Le apre chi ha accesso globale (è la revisione editoriale).
drop policy if exists richieste_insert on public.richieste_modifica;
create policy richieste_insert on public.richieste_modifica
  for insert to authenticated
  with check (public.is_admin() and creata_da = auth.uid());

-- Le chiude sia chi le ha aperte sia il gruppo, quando ha corretto.
drop policy if exists richieste_update on public.richieste_modifica;
create policy richieste_update on public.richieste_modifica
  for update to authenticated
  using (
    public.is_admin()
    or public.is_member_of(public.polo_of_task(task_id))
  )
  with check (true);

grant select, insert, update on public.richieste_modifica to authenticated;

-- Il testo di una richiesta non si riscrive: si può solo segnarla risolta.
create or replace function public.fn_richiesta_guard()
returns trigger language plpgsql as $$
begin
  if (new.testo, new.ambito, new.task_id, new.pacchetto_id, new.creata_da, new.creata_at)
     is distinct from
     (old.testo, old.ambito, old.task_id, old.pacchetto_id, old.creata_da, old.creata_at)
  then
    raise exception 'Il testo di una richiesta non è modificabile: aprine una nuova'
      using errcode = '42501';
  end if;

  if new.stato = 'risolta' and old.stato = 'aperta' then
    new.risolta_at := now();
    new.risolta_da := auth.uid();
  end if;

  return new;
end $$;

drop trigger if exists trg_richiesta_guard on public.richieste_modifica;
create trigger trg_richiesta_guard
  before update on public.richieste_modifica
  for each row execute function public.fn_richiesta_guard();

-- ---------------------------------------------------------------- vista
-- Elenco dei video sigillati con il conteggio delle richieste aperte:
-- è la coda di revisione.
create or replace view public.v_video_da_rivedere
with (security_invoker = true) as
select
  p.id                as pacchetto_id,
  p.task_id,
  t.titolo            as progetto,
  pl.id               as polo_id,
  pl.nome             as gruppo,
  p.stato,
  p.sigillato_at,
  p.pec_inviata_at,
  t.coinvolge_terzi,
  count(r.id) filter (where r.stato = 'aperta') as richieste_aperte,
  max(r.creata_at)                              as ultima_richiesta
from public.pacchetti_video p
join public.tasks t on t.id = p.task_id
join public.poli  pl on pl.id = t.polo_id
left join public.richieste_modifica r on r.pacchetto_id = p.id
where p.stato <> 'bozza'
group by p.id, t.titolo, pl.id, pl.nome, t.coinvolge_terzi;

grant select on public.v_video_da_rivedere to authenticated;
