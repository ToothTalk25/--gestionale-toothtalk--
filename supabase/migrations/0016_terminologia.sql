-- =====================================================================
-- 0016_terminologia.sql — vocabolario neutro nei messaggi del database
-- =====================================================================
-- Vincolo di impostazione del progetto: la piattaforma non deve evocare un
-- rapporto di lavoro. Niente "titolare", "team", "collaboratore", niente
-- "consegna" nel senso di prestazione dovuta. La partecipazione è libera,
-- senza incarichi né scadenze vincolanti, e ha finalità divulgativa.
--
-- I messaggi sollevati dai trigger non restano nel database: l'applicazione
-- li inoltra tali e quali all'utente (vedi fallita() in src/app/actions.ts).
-- Vanno quindi riscritti qui, non basta cambiare la UI.
--
-- Si descrive la restrizione ("non disponibile da qui"), mai il ruolo di
-- chi potrebbe superarla.
-- =====================================================================

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

  -- Chiunque partecipi al gruppo può sigillare: è la tutela di tutti.
  if not (public.is_admin() or public.is_member_of(v_polo_id)) then
    raise exception 'Non fai parte del gruppo di questo progetto' using errcode = '42501';
  end if;

  if v_p.stato <> 'bozza' then
    raise exception 'Pacchetto già sigillato (stato: %)', v_p.stato;
  end if;

  select t.coinvolge_terzi into v_coinvolge_terzi from public.tasks t where t.id = v_p.task_id;

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
    raise exception 'Il video mostra una persona esterna: manca la liberatoria';
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
    )
  );

  v_manifest := jsonb_build_object(
    'versione_formato', 1,
    'emittente', 'ToothTalk — progetto di divulgazione odontoiatrica',
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

-- Messaggi degli altri trigger, ripuliti allo stesso modo.
create or replace function public.fn_versions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.bucket = 'finali' and exists (
      select 1
      from public.pacchetto_elementi pe
      join public.pacchetti_video p on p.id = pe.pacchetto_id
      where pe.version_id = old.id and p.stato <> 'bozza'
    ) then
      raise exception 'Video completo già sigillato: i file non si eliminano più'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.bucket = 'finali' and old.origin = 'originale' then
    raise exception 'File del video completo depositato il %: immutabile', old.uploaded_at
      using errcode = '42501';
  end if;

  if (new.sha256, new.storage_path, new.record_hash, new.prev_record_hash,
      new.uploaded_by, new.uploaded_at, new.version_no, new.origin, new.deliverable_id)
     is distinct from
     (old.sha256, old.storage_path, old.record_hash, old.prev_record_hash,
      old.uploaded_by, old.uploaded_at, old.version_no, old.origin, old.deliverable_id)
  then
    raise exception 'I dati di identificazione di un file non sono modificabili'
      using errcode = '42501';
  end if;

  return new;
end $$;

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
    raise exception 'Il file non appartiene a questo progetto' using errcode = '42501';
  end if;
  if v_origin <> 'originale' or v_bucket <> 'finali' then
    raise exception 'Nel video completo entrano solo i file caricati come materiale finale'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- Commenti di schema: descrivono il modello, vanno allineati anche loro.
comment on table public.poli is
  'Gruppi universitari che partecipano al progetto. Nessuna gerarchia interna.';

comment on table public.memberships is
  'Appartenenza a un gruppo universitario: paritetica, tutti i partecipanti '
  'hanno identici permessi. Nessun ruolo interno, nessun coordinatore.';

comment on table public.deliverable_versions is
  'Registro dei file. Quelli del bucket finali (video completo) sono '
  'immutabili una volta sigillati; i materiali di lavorazione sono '
  'liberamente gestibili da chi partecipa al gruppo.';

comment on column public.tasks.locked is
  'Progetto congelato: i contenuti non sono più modificabili.';
