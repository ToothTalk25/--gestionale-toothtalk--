-- =====================================================================
-- ToothTalk — Gestionale interno
-- 0001_schema.sql : tipi, tabelle, trigger di integrità e catena di hash
-- =====================================================================
-- Principi architetturali codificati qui dentro:
--  1. I poli sono GRUPPI PIATTI: la tabella memberships NON ha una colonna
--     "ruolo interno". Chi appartiene al polo ha esattamente gli stessi
--     poteri di chiunque altro dello stesso polo.
--  2. Il registro delle versioni è APPEND-ONLY. Una consegna originale, una
--     volta scritta, non è più modificabile né cancellabile da nessuno
--     (nemmeno dall'Admin, nemmeno dal service_role: il blocco è a livello
--     di trigger, non di policy).
--  3. Ogni versione è concatenata alla precedente tramite hash (record_hash)
--     -> una manomissione a valle rompe la catena ed è dimostrabile.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tipi
do $$ begin
  create type public.user_role as enum ('admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum (
    'da_fare',           -- assegnata, nulla di consegnato
    'consegnato',        -- il team ha caricato le deliverable
    'in_revisione',      -- l'Admin sta valutando
    'modificato_admin',  -- l'Admin ha prodotto una versione editata
    'approvato',         -- ok al pubblicazione
    'pubblicato',        -- online
    'respinto'           -- rimandata al team
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deliverable_kind as enum (
    'script', 'video_grezzo', 'thumbnail', 'liberatoria', 'audio', 'altro'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'originale'  = ciò che il team ha consegnato. Immutabile.
  -- 'admin_edit' = ciò che l'Admin ha prodotto a partire dall'originale.
  create type public.version_origin as enum ('originale', 'admin_edit');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- tabelle

create table if not exists public.poli (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  slug        text not null unique,
  citta       text,
  attivo      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.poli is 'Poli territoriali (es. Insubria, Genova). Nessuna gerarchia interna.';

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.user_role not null default 'member',
  attivo      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on column public.profiles.role is
  'Ruolo GLOBALE. admin = Titolare (accesso trasversale). member = componente di uno o più poli.';

-- Modello piatto: nessun campo "referente"/"capo". L''appartenenza è binaria.
create table if not exists public.memberships (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  polo_id     uuid not null references public.poli(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, polo_id)
);
comment on table public.memberships is
  'Appartenenza paritetica: tutti i membri dello stesso polo hanno identici permessi.';

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  polo_id     uuid not null references public.poli(id) on delete restrict,
  titolo      text not null,
  script      text,
  descrizione text,
  note_admin  text,                                   -- scrivibile solo dall'Admin
  status      public.task_status not null default 'da_fare',
  scadenza    date,
  locked      boolean not null default false,         -- congelamento contenuti (Admin)
  published_url text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tasks_polo on public.tasks(polo_id);
create index if not exists idx_tasks_status on public.tasks(status);

-- Una "deliverable" è uno slot logico (es. "il video grezzo di questa task").
-- Le sue versioni concrete vivono in deliverable_versions.
create table if not exists public.deliverables (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  kind        public.deliverable_kind not null,
  titolo      text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_deliverables_task on public.deliverables(task_id);

-- REGISTRO PROBATORIO. Append-only, hash-chained, mai aggiornato, mai cancellato.
create table if not exists public.deliverable_versions (
  id               uuid primary key default gen_random_uuid(),
  deliverable_id   uuid not null references public.deliverables(id) on delete restrict,
  version_no       int  not null,                  -- assegnato dal trigger
  origin           public.version_origin not null,
  bucket           text not null,
  storage_path     text not null unique,
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint,
  sha256           text not null,                  -- impronta del contenuto (calcolata dal client)
  prev_record_hash text,                           -- catena
  record_hash      text not null,                  -- calcolato dal trigger
  uploaded_by      uuid not null references public.profiles(id),
  uploaded_at      timestamptz not null default now(),
  sealed_at        timestamptz,                    -- valorizzato per le consegne originali
  note             text,
  constraint chk_origin_bucket check (
       (origin = 'originale'  and bucket = 'originali')
    or (origin = 'admin_edit' and bucket = 'revisioni')
  ),
  constraint chk_sha256 check (sha256 ~ '^[0-9a-f]{64}$'),
  unique (deliverable_id, version_no)
);
create index if not exists idx_versions_deliverable on public.deliverable_versions(deliverable_id);
create index if not exists idx_versions_origin on public.deliverable_versions(origin);

comment on table public.deliverable_versions is
  'Archivio di tutela legale. origin=originale è la consegna del team ed è immutabile; '
  'origin=admin_edit è la rielaborazione del Titolare. Le due non si sovrascrivono mai.';

create table if not exists public.task_status_history (
  id          bigserial primary key,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  da_status   public.task_status,
  a_status    public.task_status not null,
  actor       uuid references public.profiles(id),
  at          timestamptz not null default now()
);
create index if not exists idx_status_history_task on public.task_status_history(task_id);

create table if not exists public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid references public.profiles(id),
  actor_role  public.user_role,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  polo_id     uuid references public.poli(id),
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists idx_audit_polo on public.audit_log(polo_id, at desc);
create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id);

-- ------------------------------------------------- funzioni di supporto

-- Cast difensivo: i path di storage vengono parsati per ricavare il polo_id.
create or replace function public.try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create or replace function public.is_service_role()
returns boolean language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.attivo
  );
$$;

create or replace function public.is_member_of(p_polo uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_polo is not null and exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.polo_id = p_polo
  );
$$;

create or replace function public.polo_of_task(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.polo_id from public.tasks t where t.id = p_task;
$$;

create or replace function public.polo_of_deliverable(p_deliverable uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.polo_id
  from public.deliverables d
  join public.tasks t on t.id = d.task_id
  where d.id = p_deliverable;
$$;

-- Accesso in lettura: l'Admin vede tutto, il membro vede il proprio polo.
create or replace function public.can_read_polo(p_polo uuid)
returns boolean language sql stable as $$
  select public.is_admin() or public.is_member_of(p_polo);
$$;

-- Una task "bloccata" dal Titolare non accetta più consegne. Il controllo
-- serve nelle policy di INSERT (tabella e storage), non solo nei trigger:
-- altrimenti si potrebbe depositare un file su una task congelata.
create or replace function public.task_aperta(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not t.locked from public.tasks t where t.id = p_task), false);
$$;

create or replace function public.task_aperta_per_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not t.locked
    from public.deliverables d
    join public.tasks t on t.id = d.task_id
    where d.id = p_deliverable
  ), false);
$$;

-- ------------------------------------------------------------- trigger

create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Creazione automatica del profilo. Il ruolo NON viene mai letto dai metadati
-- forniti dal client: promuovere ad admin si fa solo via SQL/service_role.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'member'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nessuno può auto-promuoversi: il cambio di ruolo passa da Admin o service_role.
create or replace function public.fn_protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare il ruolo di un utente' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile
  before update on public.profiles
  for each row execute function public.fn_protect_profile();

-- Regole di modifica della task per i membri (modello piatto, ma con confini).
create or replace function public.fn_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_service_role()) then
    if old.locked then
      raise exception 'Task bloccata dal Titolare: contenuti non modificabili' using errcode = '42501';
    end if;
    if new.polo_id is distinct from old.polo_id then
      raise exception 'Non puoi spostare una task su un altro polo' using errcode = '42501';
    end if;
    if new.locked is distinct from old.locked then
      raise exception 'Solo il Titolare può bloccare/sbloccare una task' using errcode = '42501';
    end if;
    if new.status not in ('da_fare', 'consegnato', 'in_revisione') then
      raise exception 'Stato "%" riservato al Titolare', new.status using errcode = '42501';
    end if;
    -- campi di competenza esclusiva dell'Admin: ignorati silenziosamente
    new.note_admin    := old.note_admin;
    new.published_url := old.published_url;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_tasks_guard on public.tasks;
create trigger trg_tasks_guard
  before update on public.tasks
  for each row execute function public.fn_tasks_guard();

create or replace function public.fn_tasks_status_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_status_history (task_id, da_status, a_status, actor)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.task_status_history (task_id, da_status, a_status, actor)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_status_history on public.tasks;
create trigger trg_tasks_status_history
  after insert or update on public.tasks
  for each row execute function public.fn_tasks_status_history();

-- ---------------------------------------------------------------------
-- CUORE DEL SISTEMA PROBATORIO
-- ---------------------------------------------------------------------
-- 1) numerazione versione e catena di hash calcolate dal server (il client
--    non può falsificarle: qualsiasi valore inviato viene sovrascritto);
-- 2) sigillo temporale sulle consegne originali.
create or replace function public.fn_seal_version()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev_hash text;
  v_prev_no   int;
begin
  select record_hash, version_no
    into v_prev_hash, v_prev_no
  from public.deliverable_versions
  where deliverable_id = new.deliverable_id
  order by version_no desc
  limit 1;

  new.version_no       := coalesce(v_prev_no, 0) + 1;
  new.prev_record_hash := v_prev_hash;
  new.uploaded_at      := now();

  new.record_hash := encode(
    extensions.digest(
      concat_ws('|',
        coalesce(v_prev_hash, 'GENESIS'),
        new.deliverable_id::text,
        new.version_no::text,
        new.origin::text,
        new.sha256,
        new.storage_path,
        new.uploaded_by::text,
        to_char(new.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ')
      ),
      'sha256'
    ),
    'hex'
  );

  if new.origin = 'originale' then
    new.sealed_at := new.uploaded_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_seal_version on public.deliverable_versions;
create trigger trg_seal_version
  before insert on public.deliverable_versions
  for each row execute function public.fn_seal_version();

-- Immutabilità assoluta del registro. Questo trigger si applica anche al
-- service_role e all'Admin: non esiste percorso applicativo per riscrivere
-- o cancellare una consegna. (Solo il proprietario della tabella, via
-- ALTER TABLE ... DISABLE TRIGGER, potrebbe aggirarlo: azione visibile nei
-- log di Postgres e fuori dal perimetro dell'applicazione.)
create or replace function public.fn_versions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registro append-only: la versione % non può essere cancellata', old.id
      using errcode = '42501';
  end if;

  if old.origin = 'originale' then
    raise exception 'Consegna originale % sigillata il %: immutabile', old.id, old.sealed_at
      using errcode = '42501';
  end if;

  -- Sulle versioni admin resta modificabile solo la nota descrittiva.
  if (new.sha256, new.storage_path, new.record_hash, new.prev_record_hash,
      new.uploaded_by, new.uploaded_at, new.version_no, new.origin, new.deliverable_id)
     is distinct from
     (old.sha256, old.storage_path, old.record_hash, old.prev_record_hash,
      old.uploaded_by, old.uploaded_at, old.version_no, old.origin, old.deliverable_id)
  then
    raise exception 'I dati probatori di una versione non sono modificabili'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_versions_append_only on public.deliverable_versions;
create trigger trg_versions_append_only
  before update or delete on public.deliverable_versions
  for each row execute function public.fn_versions_append_only();

-- Il log di audit è a sua volta append-only.
create or replace function public.fn_audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log è append-only' using errcode = '42501';
end $$;

drop trigger if exists trg_audit_append_only on public.audit_log;
create trigger trg_audit_append_only
  before update or delete on public.audit_log
  for each row execute function public.fn_audit_append_only();

-- Passaggio automatico a "consegnato" alla prima consegna originale.
create or replace function public.fn_version_side_effects()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task uuid;
  v_polo uuid;
begin
  select d.task_id, t.polo_id into v_task, v_polo
  from public.deliverables d
  join public.tasks t on t.id = d.task_id
  where d.id = new.deliverable_id;

  if new.origin = 'originale' then
    update public.tasks
       set status = 'consegnato'
     where id = v_task and status = 'da_fare';
  else
    update public.tasks
       set status = 'modificato_admin'
     where id = v_task and status in ('consegnato', 'in_revisione');
  end if;

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (
    new.uploaded_by,
    case when new.origin = 'originale' then 'member'::public.user_role else 'admin'::public.user_role end,
    case when new.origin = 'originale' then 'consegna_originale' else 'upload_versione_admin' end,
    'deliverable_version',
    new.id,
    v_polo,
    jsonb_build_object(
      'task_id', v_task,
      'file_name', new.file_name,
      'sha256', new.sha256,
      'record_hash', new.record_hash,
      'version_no', new.version_no
    )
  );
  return new;
end $$;

drop trigger if exists trg_version_side_effects on public.deliverable_versions;
create trigger trg_version_side_effects
  after insert on public.deliverable_versions
  for each row execute function public.fn_version_side_effects();

-- ------------------------------------------------------------- verifica
-- Ricalcola la catena di una deliverable e segnala eventuali rotture.
-- Uso: select * from public.verifica_catena('<deliverable_id>');
create or replace function public.verifica_catena(p_deliverable uuid)
returns table (
  version_no  int,
  origin      public.version_origin,
  file_name   text,
  uploaded_at timestamptz,
  integra     boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r        record;
  v_prev   text := null;
  v_calc   text;
begin
  -- L'alias "v" è necessario: senza, "order by version_no" sarebbe ambiguo
  -- fra la colonna e il parametro OUT omonimo di questa funzione.
  for r in
    select v.* from public.deliverable_versions v
    where v.deliverable_id = p_deliverable
    order by v.version_no
  loop
    v_calc := encode(extensions.digest(
      concat_ws('|',
        coalesce(v_prev, 'GENESIS'), r.deliverable_id::text, r.version_no::text,
        r.origin::text, r.sha256, r.storage_path, r.uploaded_by::text,
        to_char(r.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.USZ')
      ), 'sha256'), 'hex');

    version_no  := r.version_no;
    origin      := r.origin;
    file_name   := r.file_name;
    uploaded_at := r.uploaded_at;
    integra     := (v_calc = r.record_hash) and (coalesce(r.prev_record_hash,'') = coalesce(v_prev,''));
    v_prev      := r.record_hash;
    return next;
  end loop;
end $$;
