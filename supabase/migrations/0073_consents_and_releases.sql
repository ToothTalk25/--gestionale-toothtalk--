-- =====================================================================
-- 0073_consents_and_releases.sql — Registro granulare consensi e liberatorie
-- =====================================================================
-- GDPR Art. 5, 6, 7: registro dimostrabile di ogni consenso/liberatoria,
-- associato indissolubilmente alla task e al soggetto, con impronta
-- SHA-256 del documento firmato, timestamp e stato di revoca.
--
-- Qui confluiscono:
--   * liberatorie di soggetti esterni (maggiorenni o minori/genitori)
--     firmate via flusso OTP (azioni-liberatoria);
--   * accordi di collaborazione dei membri (accordo editoriale firmato).
--
-- Append-only: i documenti firmati non si cancellano; una revoca si
-- registra sul record (is_revoked, revocato_at, revocato_da).
-- =====================================================================

create table if not exists public.consents_and_releases (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid references public.tasks(id) on delete cascade,
  user_id         uuid references public.profiles(id),
  richiesta_id    uuid references public.richieste_liberatoria(id),
  -- tipo di soggetto firmatario
  tipo_soggetto   text not null
                  check (tipo_soggetto in ('maggiorenne', 'minore', 'collaboratore')),
  -- tipo di documento firmato
  tipo            text not null default 'liberatoria'
                  check (tipo in ('liberatoria', 'accordo_collaboratore', 'nda')),
  nome_soggetto   text not null,
  email_soggetto  text,
  -- percorso nel bucket storage + impronta SHA-256 del file firmato
  storage_path    text not null,
  sha256          text not null,
  -- come è stato firmato (per la liberatoria: solo OTP sblocca il sigillo)
  metodo_firma    text check (metodo_firma in ('otp', 'canvas', 'upload_manuale')),
  firmato_at      timestamptz not null default now(),
  -- revoca (append-only: il record resta, si marca la revoca)
  is_revoked      boolean not null default false,
  revocato_at     timestamptz,
  revocato_da     uuid references public.profiles(id),
  creato_at       timestamptz not null default now()
);

create index if not exists idx_cnr_task   on public.consents_and_releases(task_id);
create index if not exists idx_cnr_user   on public.consents_and_releases(user_id);
create index if not exists idx_cnr_validi on public.consents_and_releases(task_id, tipo, is_revoked);

alter table public.consents_and_releases enable row level security;

-- L'Admin vede tutto; i membri del polo vedono le liberatorie delle proprie task.
drop policy if exists cnr_select on public.consents_and_releases;
create policy cnr_select on public.consents_and_releases
  for select to authenticated
  using (
    public.is_admin()
    or (
      task_id is not null
      and public.can_read_polo(public.polo_of_task(task_id))
    )
    or (task_id is null and user_id = auth.uid())
  );

-- Inserimento: solo Admin (l'admin inserisce gli accordi collaboratore) e il
-- flusso di firma pubblica usa la service role (fuori da questa policy).
drop policy if exists cnr_insert_admin on public.consents_and_releases;
create policy cnr_insert_admin on public.consents_and_releases
  for insert to authenticated
  with check (public.is_admin());

-- Revoca: solo Admin. Append-only, nessuna UPDATE di altri campi.
drop policy if exists cnr_revoke_admin on public.consents_and_releases;
create policy cnr_revoke_admin on public.consents_and_releases
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.consents_and_releases to authenticated;
grant insert, update on public.consents_and_releases to authenticated;
revoke delete on public.consents_and_releases from authenticated;

-- ------------------------------------------------------ helper guardrail
-- True se la task ha ALMENO UN consenso/liberatoria valido e attivo
-- (non revocato). Usato dalle policy e dal trigger di stato delle task:
-- senza un consenso valido, un contenuto che coinvolge terzi NON può
-- avanzare oltre "consegnato".
create or replace function public.consenso_task_valido(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.consents_and_releases c
    where c.task_id = p_task
      and c.tipo = 'liberatoria'
      and not c.is_revoked
  );
$$;

comment on function public.consenso_task_valido(uuid) is
  'True se la task ha una liberatoria valida e non revocata.';

-- -------------------------------------------- guardrail transizioni stato
-- Un contenuto che coinvolge una persona esterna (coinvolge_terzi) non può
-- passare a 'in_revisione' o 'approvato' se manca un consenso valido e
-- attivo. Il blocco vale per chiunque (membro o Admin): è un vincolo
-- legale, non un permesso.
create or replace function public.fn_task_consenso_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('in_revisione', 'approvato')
     and old.status in ('consegnato', 'da_fare', 'in_revisione') then
    if exists (
      select 1 from public.tasks t
      where t.id = new.id and t.coinvolge_terzi
    ) and not public.consenso_task_valido(new.id) then
      raise exception 'Il progetto coinvolge una persona esterna: la liberatoria firmata e valida è obbligatoria prima di passare in revisione'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_task_consenso_guard on public.tasks;
create trigger trg_task_consenso_guard
  before update on public.tasks
  for each row execute function public.fn_task_consenso_guard();
