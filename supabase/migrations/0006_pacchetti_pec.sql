-- =====================================================================
-- 0006_pacchetti_pec.sql — "Video completo": pacchetto sigillabile e PEC
-- =====================================================================
-- Distinzione portante:
--
--   MATERIALI DI LAVORAZIONE (video grezzo, liberatorie, audio, note…)
--     -> restano nell'archivio 'originali', immutabili ma NON certificati
--        via PEC. Sono materiale di processo, cambiano, si accumulano.
--
--   PACCHETTO PUBBLICABILE ("Video completo")
--     -> esattamente 4 elementi: video montato, copertina, descrizione,
--        script. È ciò che finisce sui social, quindi è l'unica cosa da cui
--        team e Titolare devono davvero tutelarsi.
--     -> vive in un archivio separato ('finali'), viene SIGILLATO in un
--        manifesto immutabile e spedito via PEC: la ricevuta della PEC dà
--        DATA CERTA a quel contenuto.
--
-- Il manifesto non è costruito dal client: lo genera il database leggendo le
-- righe già sigillate del registro. Nessuno può farsi certificare qualcosa
-- di diverso da ciò che ha effettivamente caricato.
-- =====================================================================

-- Il pacchetto vive in un bucket suo: l'archivio certificato si esporta,
-- si ispeziona e si conserva senza mescolarsi al materiale di lavorazione.
insert into storage.buckets (id, name, public, file_size_limit)
values ('finali', 'finali', false, 5368709120)
on conflict (id) do update set public = false;

alter table public.deliverable_versions drop constraint if exists chk_origin_bucket;
alter table public.deliverable_versions add constraint chk_origin_bucket check (
     (origin = 'originale'  and bucket in ('originali', 'finali'))
  or (origin = 'admin_edit' and bucket = 'revisioni')
);

-- Stesse identiche regole di 'originali': si può solo depositare.
drop policy if exists finali_select on storage.objects;
create policy finali_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'finali'
    and public.can_read_polo(public.storage_polo_id(name))
  );

drop policy if exists finali_insert on storage.objects;
create policy finali_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'finali'
    and public.storage_path_valido(name)
    and public.is_member_of(public.storage_polo_id(name))
    and public.task_aperta(public.storage_task_id(name))
  );
-- >>> nessuna policy UPDATE/DELETE sul bucket 'finali'. <<<

-- ---------------------------------------------------------------- tipi
do $$ begin
  create type public.pacchetto_stato as enum (
    'bozza',          -- in composizione, modificabile
    'sigillato',      -- manifesto congelato, in attesa di spedizione
    'pec_inviata',    -- PEC partita, message-id registrato
    'pec_confermata', -- ricevuta di avvenuta consegna archiviata
    'pec_errore',     -- spedizione fallita, ritentabile
    'annullato'       -- invalidato dal Titolare, resta a registro
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ruolo_elemento as enum ('video', 'copertina');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- tabelle

create table if not exists public.pacchetti_video (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete restrict,
  descrizione    text,            -- la caption che verrà pubblicata
  script         text,            -- lo script effettivamente usato per girare
  stato          public.pacchetto_stato not null default 'bozza',

  -- congelati dal sigillo
  manifest       jsonb,
  manifest_hash  text,
  sigillato_at   timestamptz,
  sigillato_da   uuid references public.profiles(id),

  -- esito della certificazione
  pec_destinatari text[],
  pec_message_id  text,
  pec_inviata_at  timestamptz,
  pec_errore      text,
  pec_ricevuta_note text,

  annullato_motivo text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

-- Un solo pacchetto vivo per task: se sbagliano, il Titolare lo annulla e
-- se ne compone un altro. Quello annullato resta a registro per sempre.
create unique index if not exists uq_pacchetto_task_vivo
  on public.pacchetti_video (task_id)
  where stato <> 'annullato';

create table if not exists public.pacchetto_elementi (
  pacchetto_id uuid not null references public.pacchetti_video(id) on delete cascade,
  ruolo        public.ruolo_elemento not null,
  version_id   uuid not null references public.deliverable_versions(id) on delete restrict,
  primary key (pacchetto_id, ruolo)
);

comment on table public.pacchetto_elementi is
  'Punta alla VERSIONE esatta usata, non alla deliverable: se il team carica '
  'un nuovo montaggio dopo il sigillo, il pacchetto certificato continua a '
  'riferirsi al file che è stato davvero spedito via PEC.';

-- ------------------------------------------------------------- integrità

-- L'elemento deve essere una consegna del team, nell'archivio finali,
-- e appartenere alla stessa task del pacchetto.
create or replace function public.fn_elemento_coerente()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task_pacchetto uuid;
  v_task_versione  uuid;
  v_origin public.version_origin;
  v_bucket text;
begin
  select task_id into v_task_pacchetto from public.pacchetti_video where id = new.pacchetto_id;

  select d.task_id, v.origin, v.bucket
    into v_task_versione, v_origin, v_bucket
  from public.deliverable_versions v
  join public.deliverables d on d.id = v.deliverable_id
  where v.id = new.version_id;

  if v_task_versione is distinct from v_task_pacchetto then
    raise exception 'Il file non appartiene a questa task' using errcode = '42501';
  end if;
  if v_origin <> 'originale' or v_bucket <> 'finali' then
    raise exception 'Nel pacchetto pubblicabile entrano solo consegne del team caricate come materiale finale'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_elemento_coerente on public.pacchetto_elementi;
create trigger trg_elemento_coerente
  before insert or update on public.pacchetto_elementi
  for each row execute function public.fn_elemento_coerente();

-- Dopo il sigillo la composizione non si tocca più.
create or replace function public.fn_elementi_congelati()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stato public.pacchetto_stato;
begin
  select stato into v_stato from public.pacchetti_video
   where id = coalesce(new.pacchetto_id, old.pacchetto_id);

  if v_stato <> 'bozza' then
    raise exception 'Pacchetto già sigillato: composizione non modificabile'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_elementi_congelati on public.pacchetto_elementi;
create trigger trg_elementi_congelati
  before insert or update or delete on public.pacchetto_elementi
  for each row execute function public.fn_elementi_congelati();

-- Il pacchetto: modificabile finché è bozza; dopo, solo l'esito PEC può
-- avanzare, e solo attraverso le funzioni dedicate (che alzano un flag di
-- sessione). Un UPDATE diretto dal client non può cambiare stato o manifesto.
create or replace function public.fn_pacchetto_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_autorizzato boolean := coalesce(current_setting('app.sigillo_in_corso', true), '') = '1';
begin
  if v_autorizzato then
    return new;
  end if;

  if old.stato = 'bozza' then
    -- In bozza si modificano testi e nient'altro.
    if (new.stato, new.manifest, new.manifest_hash, new.sigillato_at, new.sigillato_da,
        new.pec_message_id, new.pec_inviata_at, new.task_id)
       is distinct from
       (old.stato, old.manifest, old.manifest_hash, old.sigillato_at, old.sigillato_da,
        old.pec_message_id, old.pec_inviata_at, old.task_id)
    then
      raise exception 'Sigillo e spedizione passano dalle funzioni dedicate'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Pacchetto sigillato il %: immutabile', old.sigillato_at
    using errcode = '42501';
end $$;

drop trigger if exists trg_pacchetto_guard on public.pacchetti_video;
create trigger trg_pacchetto_guard
  before update on public.pacchetti_video
  for each row execute function public.fn_pacchetto_guard();

create or replace function public.fn_pacchetto_no_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Un pacchetto non si cancella: il Titolare può solo annullarlo'
    using errcode = '42501';
end $$;

drop trigger if exists trg_pacchetto_no_delete on public.pacchetti_video;
create trigger trg_pacchetto_no_delete
  before delete on public.pacchetti_video
  for each row execute function public.fn_pacchetto_no_delete();

-- ---------------------------------------------------------------------
-- SIGILLO
-- ---------------------------------------------------------------------
-- Costruisce il manifesto leggendo il registro (mai l'input del client),
-- ne calcola l'impronta e congela il pacchetto.
--
-- L'hash del manifesto è SHA-256 della rappresentazione testuale del jsonb:
-- Postgres normalizza jsonb in forma canonica (chiavi ordinate, niente
-- spaziatura), quindi il valore è riproducibile e riverificabile.
create or replace function public.sigilla_pacchetto(p_pacchetto uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p         public.pacchetti_video%rowtype;
  v_polo_id   uuid;
  v_task      record;
  v_polo      record;
  v_autore    record;
  v_elementi  jsonb;
  v_manifest  jsonb;
  v_hash      text;
  v_quando    timestamptz := now();
  v_quando_s  text;
begin
  select * into v_p from public.pacchetti_video where id = p_pacchetto for update;
  if not found then
    raise exception 'Pacchetto inesistente';
  end if;

  v_polo_id := public.polo_of_task(v_p.task_id);

  -- Chiunque nel polo può sigillare: è la tutela del gruppo, non di un capo.
  if not (public.is_admin() or public.is_member_of(v_polo_id)) then
    raise exception 'Non appartieni al polo di questa consegna' using errcode = '42501';
  end if;

  if v_p.stato <> 'bozza' then
    raise exception 'Pacchetto già sigillato (stato: %)', v_p.stato;
  end if;

  -- Completezza: i quattro elementi devono esserci tutti.
  if coalesce(btrim(v_p.descrizione), '') = '' then
    raise exception 'Manca la descrizione da pubblicare';
  end if;
  if coalesce(btrim(v_p.script), '') = '' then
    raise exception 'Manca lo script usato per il video';
  end if;
  if not exists (select 1 from public.pacchetto_elementi
                 where pacchetto_id = p_pacchetto and ruolo = 'video') then
    raise exception 'Manca il video montato';
  end if;
  if not exists (select 1 from public.pacchetto_elementi
                 where pacchetto_id = p_pacchetto and ruolo = 'copertina') then
    raise exception 'Manca la copertina';
  end if;

  v_quando_s := to_char(v_quando at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  select t.id, t.titolo, t.polo_id into v_task from public.tasks t where t.id = v_p.task_id;
  select pl.id, pl.nome, pl.citta into v_polo from public.poli pl where pl.id = v_polo_id;
  select pr.id, pr.email, pr.full_name into v_autore
    from public.profiles pr where pr.id = auth.uid();

  select jsonb_agg(x.e order by x.ruolo) into v_elementi
  from (
    select
      pe.ruolo::text as ruolo,
      jsonb_build_object(
        'ruolo',        pe.ruolo,
        'tipo',         'file',
        'file_name',    v.file_name,
        'mime_type',    v.mime_type,
        'size_bytes',   v.size_bytes,
        'sha256',       v.sha256,
        'bucket',       v.bucket,
        'storage_path', v.storage_path,
        'version_id',   v.id,
        'record_hash',  v.record_hash,
        'caricato_da',  pr.email,
        'caricato_at',  to_char(v.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ) as e
    from public.pacchetto_elementi pe
    join public.deliverable_versions v on v.id = pe.version_id
    join public.profiles pr on pr.id = v.uploaded_by
    where pe.pacchetto_id = p_pacchetto
  ) x;

  -- I due elementi testuali: l'impronta è calcolata sui byte UTF-8 del testo.
  v_elementi := v_elementi || jsonb_build_array(
    jsonb_build_object(
      'ruolo', 'descrizione', 'tipo', 'testo',
      'sha256', encode(extensions.digest(v_p.descrizione, 'sha256'), 'hex'),
      'caratteri', length(v_p.descrizione),
      'testo', v_p.descrizione
    ),
    jsonb_build_object(
      'ruolo', 'script', 'tipo', 'testo',
      'sha256', encode(extensions.digest(v_p.script, 'sha256'), 'hex'),
      'caratteri', length(v_p.script),
      'testo', v_p.script
    )
  );

  v_manifest := jsonb_build_object(
    'versione_formato', 1,
    'emittente', 'ToothTalk — gestionale interno',
    'pacchetto_id', p_pacchetto,
    'task', jsonb_build_object('id', v_task.id, 'titolo', v_task.titolo),
    'polo', jsonb_build_object('id', v_polo.id, 'nome', v_polo.nome, 'citta', v_polo.citta),
    'sigillato_at', v_quando_s,
    'sigillato_da', jsonb_build_object(
      'id', v_autore.id, 'email', v_autore.email, 'nome', v_autore.full_name
    ),
    'elementi', v_elementi
  );

  v_hash := encode(extensions.digest(v_manifest::text, 'sha256'), 'hex');

  perform set_config('app.sigillo_in_corso', '1', true);

  update public.pacchetti_video
     set stato = 'sigillato',
         manifest = v_manifest,
         manifest_hash = v_hash,
         sigillato_at = v_quando,
         sigillato_da = auth.uid()
   where id = p_pacchetto;

  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(),
          case when public.is_admin() then 'admin' else 'member' end::public.user_role,
          'sigillo_pacchetto', 'pacchetto_video', p_pacchetto, v_polo_id,
          jsonb_build_object('manifest_hash', v_hash, 'task_id', v_p.task_id));

  return v_manifest || jsonb_build_object('manifest_hash', v_hash);
end $$;

-- Registrazione dell'esito PEC. Chiamata dal server dopo la spedizione
-- reale; il flag di sessione è l'unico modo per superare fn_pacchetto_guard.
create or replace function public.registra_esito_pec(
  p_pacchetto   uuid,
  p_stato       public.pacchetto_stato,
  p_message_id  text default null,
  p_destinatari text[] default null,
  p_errore      text default null,
  p_note        text default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare v_polo uuid;
begin
  if p_stato not in ('pec_inviata', 'pec_confermata', 'pec_errore') then
    raise exception 'Stato PEC non ammesso: %', p_stato;
  end if;

  select public.polo_of_task(task_id) into v_polo
  from public.pacchetti_video where id = p_pacchetto;

  perform set_config('app.sigillo_in_corso', '1', true);

  update public.pacchetti_video
     set stato = p_stato,
         pec_message_id = coalesce(p_message_id, pec_message_id),
         pec_destinatari = coalesce(p_destinatari, pec_destinatari),
         pec_inviata_at = case when p_stato = 'pec_inviata' then now() else pec_inviata_at end,
         pec_errore = p_errore,
         pec_ricevuta_note = coalesce(p_note, pec_ricevuta_note)
   where id = p_pacchetto
     and stato in ('sigillato', 'pec_inviata', 'pec_errore');

  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), null, 'pec_' || p_stato::text, 'pacchetto_video', p_pacchetto, v_polo,
          jsonb_build_object('message_id', p_message_id, 'errore', p_errore));
end $$;

-- Annullamento: solo il Titolare, e il pacchetto resta a registro.
create or replace function public.annulla_pacchetto(p_pacchetto uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Solo il Titolare può annullare un pacchetto' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica il motivo dell''annullamento';
  end if;

  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'annullato', annullato_motivo = p_motivo
   where id = p_pacchetto;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, meta)
  values (auth.uid(), 'admin', 'annullamento_pacchetto', 'pacchetto_video', p_pacchetto,
          jsonb_build_object('motivo', p_motivo));
end $$;

-- Riverifica: ricalcola l'impronta dal manifesto conservato.
create or replace function public.verifica_manifesto(p_pacchetto uuid)
returns table (manifest_hash_registrato text, manifest_hash_ricalcolato text, integro boolean)
language sql stable security definer set search_path = public, extensions as $$
  select
    p.manifest_hash,
    encode(extensions.digest(p.manifest::text, 'sha256'), 'hex'),
    p.manifest_hash = encode(extensions.digest(p.manifest::text, 'sha256'), 'hex')
  from public.pacchetti_video p
  where p.id = p_pacchetto and p.manifest is not null;
$$;

-- ----------------------------------------------------------------- RLS

alter table public.pacchetti_video    enable row level security;
alter table public.pacchetto_elementi enable row level security;

drop policy if exists pacchetti_select on public.pacchetti_video;
create policy pacchetti_select on public.pacchetti_video
  for select to authenticated
  using (public.can_read_polo(public.polo_of_task(task_id)));

drop policy if exists pacchetti_insert on public.pacchetti_video;
create policy pacchetti_insert on public.pacchetti_video
  for insert to authenticated
  with check (
    public.is_member_of(public.polo_of_task(task_id))
    and public.task_aperta(task_id)
    and stato = 'bozza'
  );

-- Solo i testi, solo in bozza: il resto lo bloccano i trigger.
drop policy if exists pacchetti_update_bozza on public.pacchetti_video;
create policy pacchetti_update_bozza on public.pacchetti_video
  for update to authenticated
  using (
    public.is_member_of(public.polo_of_task(task_id))
    and stato = 'bozza'
    and public.task_aperta(task_id)
  )
  with check (public.is_member_of(public.polo_of_task(task_id)));

drop policy if exists pacchetti_admin on public.pacchetti_video;
create policy pacchetti_admin on public.pacchetti_video
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists elementi_select on public.pacchetto_elementi;
create policy elementi_select on public.pacchetto_elementi
  for select to authenticated
  using (
    exists (
      select 1 from public.pacchetti_video p
      where p.id = pacchetto_id
        and public.can_read_polo(public.polo_of_task(p.task_id))
    )
  );

drop policy if exists elementi_write on public.pacchetto_elementi;
create policy elementi_write on public.pacchetto_elementi
  for insert to authenticated
  with check (
    exists (
      select 1 from public.pacchetti_video p
      where p.id = pacchetto_id
        and public.is_member_of(public.polo_of_task(p.task_id))
        and p.stato = 'bozza'
    )
  );

drop policy if exists elementi_update on public.pacchetto_elementi;
create policy elementi_update on public.pacchetto_elementi
  for update to authenticated
  using (
    exists (
      select 1 from public.pacchetti_video p
      where p.id = pacchetto_id
        and public.is_member_of(public.polo_of_task(p.task_id))
        and p.stato = 'bozza'
    )
  )
  with check (true);

grant select, insert, update on public.pacchetti_video, public.pacchetto_elementi to authenticated;
grant execute on function public.sigilla_pacchetto(uuid)  to authenticated;
grant execute on function public.verifica_manifesto(uuid) to authenticated;
grant execute on function public.annulla_pacchetto(uuid, text) to authenticated;

-- registra_esito_pec la chiama SOLO il server, con la service role key, dopo
-- una spedizione realmente avvenuta: se un membro potesse marcare da solo un
-- pacchetto come "PEC inviata", il valore probatorio svanirebbe.
--
-- La revoca da PUBLIC è indispensabile: Postgres concede EXECUTE a PUBLIC per
-- default su ogni funzione, quindi togliere il permesso ai soli ruoli
-- 'authenticated' e 'anon' non basterebbe — continuerebbero a chiamarla
-- ereditando il grant di PUBLIC, e PostgREST la espone come RPC.
revoke execute on function
  public.registra_esito_pec(uuid, public.pacchetto_stato, text, text[], text, text)
  from public, anon, authenticated;
grant execute on function
  public.registra_esito_pec(uuid, public.pacchetto_stato, text, text[], text, text)
  to service_role;
