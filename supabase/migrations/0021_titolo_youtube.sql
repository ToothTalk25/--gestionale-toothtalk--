-- =====================================================================
-- 0021_titolo_youtube.sql — titolo per lo Short su YouTube
-- =====================================================================
-- Il gruppo compila anche un titolo ottimizzato per YouTube Shorts, che
-- diventa un elemento certificato del pacchetto — viaggia in chiaro nella
-- PEC ed è obbligatorio per il sigillo.
-- =====================================================================

alter table public.pacchetti_video
  add column if not exists titolo_youtube text;

comment on column public.pacchetti_video.titolo_youtube is
  'Titolo da usare per lo Short su YouTube, seguendo le linee guida editoriali del progetto.';

-- Il titolo è obbligatorio per la completezza del pacchetto.
create or replace function public.pacchetto_completo(p_pacchetto uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    coalesce(btrim(p.descrizione), '') <> ''
    and coalesce(btrim(p.script), '') <> ''
    and coalesce(btrim(p.titolo_youtube), '') <> ''
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

-- Il sigillo include ora anche il titolo YouTube come elemento testuale
-- certificato, ed è obbligatorio (insieme a descrizione e script).
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

  if not public.is_admin() then
    raise exception 'Solo chi ha accesso globale può sigillare un pacchetto'
      using errcode = '42501';
  end if;

  if v_p.stato <> 'pronto' then
    raise exception 'Il pacchetto non è pronto per il sigillo (stato: %)', v_p.stato;
  end if;

  select t.coinvolge_terzi into v_coinvolge_terzi from public.tasks t where t.id = v_p.task_id;

  if coalesce(btrim(v_p.descrizione), '') = '' then
    raise exception 'Manca la descrizione da pubblicare';
  end if;
  if coalesce(btrim(v_p.script), '') = '' then
    raise exception 'Manca lo script usato per il video';
  end if;
  if coalesce(btrim(v_p.titolo_youtube), '') = '' then
    raise exception 'Manca il titolo per YouTube';
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
    ),
    jsonb_build_object(
      'ruolo', 'titolo_youtube', 'tipo', 'testo',
      'sha256', encode(extensions.digest(v_p.titolo_youtube, 'sha256'), 'hex'),
      'caratteri', length(v_p.titolo_youtube),
      'testo', v_p.titolo_youtube
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

