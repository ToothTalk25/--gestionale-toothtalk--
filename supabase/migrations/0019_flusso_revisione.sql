-- =====================================================================
-- 0019_flusso_revisione.sql — il gruppo segnala, l'accesso globale decide
-- =====================================================================
-- Nuovo flusso del pacchetto "Video completo":
--
--   bozza  --(gruppo: "Segnala completato")-------->  pronto
--   pronto --(accesso globale: "Sigilla")------------> sigillato -> PEC
--   pronto --(accesso globale: "Rimanda in composizione")--> bozza
--
-- Prima il gruppo poteva sigillare da solo e chiunque poteva spedire la PEC.
-- Da qui: la composizione resta del gruppo, ma il SIGILLO e la SPEDIZIONE
-- PEC richiedono chi ha accesso globale. Così una PEC parte solo quando il
-- materiale è stato davvero visto e confermato: niente PEC per piccole
-- correzioni, spazio della casella rispettato, una sola PEC per il pacchetto
-- definitivo.
-- =====================================================================

-- Momento in cui il gruppo ha segnalato il completamento (per la coda di
-- revisione di chi ha accesso globale).
alter table public.pacchetti_video
  add column if not exists pronto_at timestamptz;

comment on column public.pacchetti_video.pronto_at is
  'Quando il gruppo ha segnalato il pacchetto come pronto per la revisione.';

-- ------------------------------------------------- completezza del pacchetto
create or replace function public.pacchetto_completo(p_pacchetto uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce(btrim(p.descrizione), '') <> ''
    and coalesce(btrim(p.script), '') <> ''
    and exists (select 1 from public.pacchetto_elementi pe
                where pe.pacchetto_id = p.id and pe.ruolo = 'video')
    and exists (select 1 from public.pacchetto_elementi pe
                where pe.pacchetto_id = p.id and pe.ruolo = 'copertina')
    and (
      not t.coinvolge_terzi
      or exists (select 1 from public.pacchetto_elementi pe
                 where pe.pacchetto_id = p.id and pe.ruolo = 'liberatoria')
    )
  from public.pacchetti_video p
  join public.tasks t on t.id = p.task_id
  where p.id = p_pacchetto;
$$;

-- ------------------------------------------------- segnalazione del gruppo
create or replace function public.segnala_completato(p_pacchetto uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p   public.pacchetti_video%rowtype;
  v_polo uuid;
begin
  select * into v_p from public.pacchetti_video where id = p_pacchetto for update;
  if not found then
    raise exception 'Pacchetto inesistente';
  end if;

  v_polo := public.polo_of_task(v_p.task_id);
  if not (public.is_admin() or public.is_member_of(v_polo)) then
    raise exception 'Non appartieni al gruppo di questo progetto' using errcode = '42501';
  end if;

  if v_p.stato <> 'bozza' then
    raise exception 'Il pacchetto non è in composizione (stato: %)', v_p.stato;
  end if;

  if not public.pacchetto_completo(p_pacchetto) then
    raise exception 'Il pacchetto non è completo: manca uno degli elementi obbligatori';
  end if;

  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'pronto', pronto_at = now()
   where id = p_pacchetto;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(),
          case when public.is_admin() then 'admin' else 'member' end::public.user_role,
          'segnalazione_completamento', 'pacchetto_video', p_pacchetto, v_polo,
          jsonb_build_object('task_id', v_p.task_id));
end $$;

-- ---------------------------------------------------------------- sigillo
-- Il sigillo ora richiede chi ha accesso globale e un pacchetto 'pronto'.
-- Il manifesto resta costruito dal database leggendo il registro: mai input
-- del client.
create or replace function public.sigilla_pacchetto(p_pacchetto uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p         public.pacchetti_video%rowtype;
  v_polo_id   uuid;
  v_coinvolge_terzi boolean;
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

  -- Il sigillo lo fa chi ha accesso globale, dopo aver visto il materiale.
  if not public.is_admin() then
    raise exception 'Solo chi ha accesso globale può sigillare un pacchetto'
      using errcode = '42501';
  end if;

  if v_p.stato <> 'pronto' then
    raise exception 'Il pacchetto non è pronto per il sigillo (stato: %)', v_p.stato;
  end if;

  select t.coinvolge_terzi into v_coinvolge_terzi from public.tasks t where t.id = v_p.task_id;

  -- Completezza: gli elementi obbligatori devono esserci tutti. La
  -- liberatoria si aggiunge alla lista solo se il progetto la richiede.
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
  if v_coinvolge_terzi and not exists (
    select 1 from public.pacchetto_elementi
    where pacchetto_id = p_pacchetto and ruolo = 'liberatoria'
  ) then
    raise exception 'Il progetto coinvolge una persona esterna: manca la liberatoria';
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
  values (auth.uid(), 'admin'::public.user_role,
          'sigillo_pacchetto', 'pacchetto_video', p_pacchetto, v_polo_id,
          jsonb_build_object('manifest_hash', v_hash, 'task_id', v_p.task_id));

  return v_manifest || jsonb_build_object('manifest_hash', v_hash);
end $$;

-- ------------------------------------------- rimando in composizione
-- Chi ha accesso globale ha visto il materiale e non lo ritiene pronto:
-- il pacchetto torna in bozza, il gruppo lo modifica e risegnala. Nessuna
-- PEC è partita, quindi non c'è nulla da annullare.
create or replace function public.rimanda_in_composizione(p_pacchetto uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p   public.pacchetti_video%rowtype;
  v_polo uuid;
begin
  select * into v_p from public.pacchetti_video where id = p_pacchetto for update;
  if not found then
    raise exception 'Pacchetto inesistente';
  end if;

  if not public.is_admin() then
    raise exception 'Solo chi ha accesso globale può rimettere in composizione un pacchetto'
      using errcode = '42501';
  end if;

  if v_p.stato <> 'pronto' then
    raise exception 'Si rimette in composizione solo un pacchetto in attesa di revisione (stato: %)',
      v_p.stato;
  end if;

  v_polo := public.polo_of_task(v_p.task_id);
  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'bozza', pronto_at = null
   where id = p_pacchetto;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), 'admin'::public.user_role, 'riapertura_composizione',
          'pacchetto_video', p_pacchetto, v_polo,
          jsonb_build_object('task_id', v_p.task_id));
end $$;

-- --------------------------------------------------- messaggi dei trigger
-- I messaggi descrivono la restrizione, mai chi potrebbe superarla. Con lo
-- stato 'pronto' i vecchi messaggi parlavano di "sigillato": si rendono
-- neutri.
create or replace function public.fn_elementi_congelati()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_stato public.pacchetto_stato;
begin
  select stato into v_stato from public.pacchetti_video
   where id = coalesce(new.pacchetto_id, old.pacchetto_id);

  if v_stato <> 'bozza' then
    raise exception 'La composizione del pacchetto non è più modificabile'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.fn_pacchetto_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_autorizzato boolean := coalesce(current_setting('app.sigillo_in_corso', true), '') = '1';
begin
  if v_autorizzato then
    return new;
  end if;

  if old.stato = 'bozza' then
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

  if old.stato = 'pronto' then
    raise exception 'Pacchetto in attesa di revisione: non modificabile da qui'
      using errcode = '42501';
  end if;

  raise exception 'Pacchetto sigillato il %: immutabile', old.sigillato_at
    using errcode = '42501';
end $$;

-- ------------------------------------------------------------- storage
-- Una volta segnalato (o sigillato) il pacchetto, il gruppo non deve più
-- depositare file nel bucket finali: non servirebbero a nulla e occuperebbero
-- spazio. Resta possibile solo finché il pacchetto è in bozza (o annullato,
-- perché se ne compone uno nuovo).
create or replace function public.storage_finale_aperto(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.pacchetti_video p
    where p.task_id = public.storage_task_id(p_name)
      and p.stato in ('pronto', 'sigillato', 'pec_inviata', 'pec_confermata', 'pec_errore')
  );
$$;

drop policy if exists finali_insert on storage.objects;
create policy finali_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'finali'
    and public.storage_path_valido(name)
    and public.is_member_of(public.storage_polo_id(name))
    and public.task_aperta(public.storage_task_id(name))
    and public.storage_finale_aperto(name)
  );

-- ------------------------------------------- coda per l'accesso globale
create or replace view public.v_pacchetti_pronti
with (security_invoker = true) as
select
  p.id as pacchetto_id,
  t.id as task_id,
  t.titolo as progetto,
  t.polo_id,
  pl.nome as gruppo,
  p.stato,
  p.pronto_at,
  p.sigillato_at
from public.pacchetti_video p
join public.tasks t on t.id = p.task_id
join public.poli pl on pl.id = t.polo_id
where p.stato = 'pronto';

grant select on public.v_pacchetti_pronti to authenticated;
grant execute on function public.segnala_completato(uuid) to authenticated;
grant execute on function public.rimanda_in_composizione(uuid) to authenticated;
grant execute on function public.pacchetto_completo(uuid) to authenticated;
grant execute on function public.sigilla_pacchetto(uuid) to authenticated;

