-- =====================================================================
-- 0089_revoca_immagine_voce.sql — revoca del consenso a immagine/voce
--                                come atto autonomo dal recesso
-- =====================================================================
-- Fino ad oggi la purga dei materiali grezzi on-screen scattava SOLO
-- come effetto collaterale di "Termina Collaborazione": uscire dal
-- progetto e revocare il consenso a immagine/voce sono invece due atti
-- distinti, e l'Informativa promette che il secondo è "revocabile in
-- ogni momento" indipendentemente dal primo — nessun canale lo permetteva.
--
-- Questa migrazione:
--   1. apre a 'immagine_voce' i tipi ammessi da revoca_consenso();
--   2. apre revoca_video_on_screen() all'AUTO-revoca (prima solo admin):
--      la logica di purga (solo grezzo non pubblicato) resta identica,
--      cambia solo chi può chiamarla;
--   3. crea richieste_rimozione_pubblicato: quando il Collaboratore
--      chiede ANCHE la rimozione dei contenuti già pubblicati, si apre
--      una pratica valutata dal Titolare (art. 17(3)(a) GDPR) — non una
--      rimozione automatica.
-- =====================================================================

-- ---------------------------------------------------------- 1. consensi

create or replace function public.revoca_consenso(p_tipo text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_tipo not in ('privacy', 'cookie', 'immagine_voce') then
    return false;
  end if;
  update public.consensi
     set revocato_at = now(),
         revocato_da = v_uid
   where user_id = v_uid
     and tipo = p_tipo
     and revocato_at is null;
  return true;
end $$;

-- ------------------------------------------------- 2. purga grezzo on-screen

create or replace function public.revoca_video_on_screen(p_user uuid)
returns table (
  version_id   uuid,
  bucket       text,
  storage_path text,
  task_id      uuid
)
language plpgsql security definer set search_path = public as $$
begin
  -- Il Titolare (chiudendo una collaborazione) o l'interessato stesso
  -- (revocando il proprio consenso) possono eseguire la revoca.
  if not (public.is_admin() or auth.uid() = p_user) then
    raise exception 'Operazione riservata al Titolare o all''interessato' using errcode = '42501';
  end if;

  drop table if exists tmp_revoca_on_commit_drop;
  create temp table tmp_revoca_on_commit_drop on commit drop as
    select v.id         as version_id,
           v.bucket,
           v.storage_path,
           d.task_id
      from public.deliverable_versions v
      join public.deliverables d on d.id = v.deliverable_id
     where v.uploaded_by  = p_user
       and v.origin       = 'originale'
       and v.revocato_gdpr = false
       and d.kind in ('video_grezzo', 'audio');

  update public.deliverable_versions v
     set revocato_gdpr = true,
         revocato_at   = now()
    from tmp_revoca_on_commit_drop t
   where v.id = t.version_id;

  update public.tasks tk
     set status = 'archived_due_to_revocation'
   where tk.id in (select distinct t.task_id from tmp_revoca_on_commit_drop t);

  return query
    select t.version_id, t.bucket, t.storage_path, t.task_id
      from tmp_revoca_on_commit_drop t;
end $$;

-- ------------------------------------- 3. richiesta di rimozione pubblicato

do $$ begin
  create type public.esito_rimozione as enum ('rimosso', 'oscurato', 'rifiutato');
exception when duplicate_object then null; end $$;

create table if not exists public.richieste_rimozione_pubblicato (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete restrict,
  richiesto_at        timestamptz not null default now(),
  termine_scadenza    timestamptz not null default (now() + interval '30 days'),
  stato               text not null default 'aperta' check (stato in ('aperta', 'risolta')),
  esito               public.esito_rimozione,
  esito_motivazione   text,
  risolta_da          uuid references public.profiles(id),
  risolta_at          timestamptz
);

comment on table public.richieste_rimozione_pubblicato is
  'Richiesta di rimozione di contenuti già pubblicati che ritraggono chi la '
  'presenta (art. 17(3)(a) GDPR — valutazione caso per caso, non rimozione '
  'automatica). richiesto_at è la data certa da cui decorrono i 30 giorni, '
  'prorogabili a 90 con motivazione scritta.';

create index if not exists idx_rimozione_user on public.richieste_rimozione_pubblicato(user_id, richiesto_at desc);
create index if not exists idx_rimozione_stato on public.richieste_rimozione_pubblicato(stato);

alter table public.richieste_rimozione_pubblicato enable row level security;

drop policy if exists rimozione_select on public.richieste_rimozione_pubblicato;
create policy rimozione_select on public.richieste_rimozione_pubblicato
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

drop policy if exists rimozione_insert on public.richieste_rimozione_pubblicato;
create policy rimozione_insert on public.richieste_rimozione_pubblicato
  for insert to authenticated
  with check (public.is_admin() or user_id = auth.uid());

-- La risolve solo il Titolare (valutazione caso per caso, non il gruppo).
drop policy if exists rimozione_update on public.richieste_rimozione_pubblicato;
create policy rimozione_update on public.richieste_rimozione_pubblicato
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.richieste_rimozione_pubblicato to authenticated;

-- Come richieste_modifica: la richiesta originale non si riscrive, si può
-- solo registrarne l'esito una volta.
create or replace function public.fn_rimozione_guard()
returns trigger language plpgsql as $$
begin
  if (new.user_id, new.richiesto_at, new.termine_scadenza)
     is distinct from
     (old.user_id, old.richiesto_at, old.termine_scadenza)
  then
    raise exception 'Una richiesta di rimozione non è modificabile nei suoi dati originali'
      using errcode = '42501';
  end if;

  if new.stato = 'risolta' and old.stato = 'aperta' then
    if new.esito is null then
      raise exception 'Indica l''esito (rimosso / oscurato / rifiutato) prima di chiudere la richiesta';
    end if;
    new.risolta_at := now();
    new.risolta_da := auth.uid();
  end if;

  return new;
end $$;

drop trigger if exists trg_rimozione_guard on public.richieste_rimozione_pubblicato;
create trigger trg_rimozione_guard
  before update on public.richieste_rimozione_pubblicato
  for each row execute function public.fn_rimozione_guard();
