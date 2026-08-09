-- =====================================================================
-- 0013_coinvolge_terzi.sql — liberatoria obbligatoria condizionale
-- =====================================================================
-- Non è il "formato" del video a decidere se serve la liberatoria (troppo
-- impreciso: due video dello stesso formato possono avere contenuti
-- diversi), ma un interruttore sul singolo progetto: "questo video mostra
-- una persona esterna al progetto?". Lo decide il team che gira il video,
-- perché è l'unico a saperlo con certezza per QUEL video specifico.
--
-- Se acceso, la liberatoria diventa un quinto elemento obbligatorio del
-- pacchetto pubblicabile: senza di essa il sigillo viene rifiutato, quindi
-- non si può nemmeno arrivare alla spedizione via PEC senza liberatoria.
-- =====================================================================

alter table public.tasks
  add column if not exists coinvolge_terzi boolean not null default false;

comment on column public.tasks.coinvolge_terzi is
  'Il video mostra una persona esterna al progetto (es. intervista). '
  'Se true, la liberatoria è un elemento obbligatorio del pacchetto '
  'pubblicabile e blocca il sigillo finché non viene caricata.';

-- fn_tasks_guard già lascia passare qualunque colonna non esplicitamente
-- azzerata per i membri: coinvolge_terzi è un dato operativo del team
-- (come lo script), non una decisione riservata all'accesso globale.
-- Nessuna modifica al trigger necessaria.

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

  -- Chiunque nel polo può sigillare: è la tutela del gruppo, non di un capo.
  if not (public.is_admin() or public.is_member_of(v_polo_id)) then
    raise exception 'Non appartieni al polo di questa consegna' using errcode = '42501';
  end if;

  if v_p.stato <> 'bozza' then
    raise exception 'Pacchetto già sigillato (stato: %)', v_p.stato;
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
  values (auth.uid(),
          case when public.is_admin() then 'admin' else 'member' end::public.user_role,
          'sigillo_pacchetto', 'pacchetto_video', p_pacchetto, v_polo_id,
          jsonb_build_object('manifest_hash', v_hash, 'task_id', v_p.task_id));

  return v_manifest || jsonb_build_object('manifest_hash', v_hash);
end $$;
