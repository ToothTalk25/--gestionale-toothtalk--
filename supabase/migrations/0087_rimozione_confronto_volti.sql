-- =====================================================================
-- 0087_rimozione_confronto_volti.sql
-- =====================================================================
-- Rimuove il blocco al sigillo/segnalazione basato sul confronto
-- automatico dei volti (Gemini). La funzionalità è stata rimossa dal
-- codice applicativo (non solo disattivata) dopo un audit GDPR: violava
-- la dichiarazione dell'Informativa privacy che escludeva ogni
-- trattamento automatizzato di riconoscimento facciale.
--
-- La tabella verifiche_riconoscimento NON viene eliminata: resta lo
-- storico di chi ha già superato o corretto il controllo in passato, ma
-- nessun nuovo codice scrive più righe al suo interno. sigilla_pacchetto
-- e segnala_completato tornano alla forma precedente all'introduzione
-- del controllo (0050/0058), meno le altre regole aggiunte nel frattempo
-- (numero video, richieste di modifica, liberatoria OTP), che restano.
-- =====================================================================

create or replace function public.segnala_completato(p_pacchetto uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p                    public.pacchetti_video%rowtype;
  v_polo                 uuid;
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

  if exists (
    select 1 from public.richieste_modifica
    where task_id = v_p.task_id and stato in ('aperta', 'da_verificare')
  ) then
    raise exception 'Ci sono richieste di modifica non ancora confermate su questo progetto: risolvile prima di segnalare il pacchetto come completato';
  end if;

  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'pronto', pronto_at = now()
   where id = p_pacchetto;
  update public.tasks
     set status = 'in_revisione'
   where id = v_p.task_id;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(),
          case when public.is_admin() then 'admin' else 'member' end::public.user_role,
          'segnalazione_completamento', 'pacchetto_video', p_pacchetto, v_polo,
          jsonb_build_object('task_id', v_p.task_id));
end $$;

create or replace function public.sigilla_pacchetto(p_pacchetto uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p                 public.pacchetti_video%rowtype;
  v_polo_id           uuid;
  v_coinvolge_terzi   boolean;
  v_script_richiesto  text;
  v_numero_video      integer;
  v_task              record;
  v_polo              record;
  v_autore            record;
  v_elementi          jsonb;
  v_manifest          jsonb;
  v_hash              text;
  v_quando            timestamptz := now();
  v_quando_s          text;
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

  if exists (
    select 1 from public.richieste_modifica
    where task_id = v_p.task_id and stato in ('aperta', 'da_verificare')
  ) then
    raise exception 'Ci sono richieste di modifica non ancora confermate su questo progetto: risolvile prima di sigillare';
  end if;

  select t.coinvolge_terzi into v_coinvolge_terzi from public.tasks t where t.id = v_p.task_id;

  select coalesce(f.script_richiesto, 'completo') into v_script_richiesto
  from public.tasks t left join public.formati f on f.id = t.formato_id
  where t.id = v_p.task_id;

  select t.numero_video into v_numero_video from public.tasks t where t.id = v_p.task_id;
  if v_numero_video is null then
    raise exception 'Manca il numero del video: serve per archiviare i materiali nella cartella Drive giusta. Assegnalo in cima alla pagina del progetto prima di sigillare.';
  end if;

  if coalesce(btrim(v_p.descrizione), '') = '' then
    raise exception 'Manca la descrizione da pubblicare';
  end if;
  if v_script_richiesto <> 'no' and coalesce(btrim(v_p.script), '') = '' then
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
    select 1 from public.richieste_liberatoria rl
    where rl.task_id = v_p.task_id
      and rl.stato = 'caricata'
      and rl.metodo_firma = 'otp'
  ) then
    raise exception 'Il progetto coinvolge una persona esterna: la liberatoria non risulta firmata tramite il flusso sicuro (OTP)';
  end if;

  v_quando_s := to_char(v_quando at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  select t.id, t.titolo, t.polo_id into v_task from public.tasks t where t.id = v_p.task_id;
  select pl.id, pl.nome, pl.citta into v_polo from public.poli pl where pl.id = v_polo_id;
  select pr.id, pr.email, pr.full_name into v_autore from public.profiles pr where pr.id = auth.uid();

  select jsonb_agg(x.e order by x.ruolo) into v_elementi
  from (
    select pe.ruolo::text as ruolo,
      jsonb_build_object(
        'ruolo', pe.ruolo, 'tipo', 'file',
        'file_name', v.file_name, 'mime_type', v.mime_type,
        'size_bytes', v.size_bytes, 'sha256', v.sha256,
        'bucket', v.bucket, 'storage_path', v.storage_path,
        'version_id', v.id, 'record_hash', v.record_hash,
        'caricato_da', pr.email,
        'caricato_at', to_char(v.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ) as e
    from public.pacchetto_elementi pe
    join public.deliverable_versions v on v.id = pe.version_id
    join public.profiles pr on pr.id = v.uploaded_by
    where pe.pacchetto_id = p_pacchetto
  ) x;

  -- Immagini di montaggio: solo impronta nel manifesto, non allegate.
  v_elementi := v_elementi || coalesce((
    select jsonb_agg(x.e order by x.file_name)
    from (
      select
        jsonb_build_object(
          'ruolo', 'immagini_montaggio', 'tipo', 'file',
          'file_name', dv.file_name, 'mime_type', dv.mime_type,
          'size_bytes', dv.size_bytes, 'sha256', dv.sha256,
          'bucket', dv.bucket, 'storage_path', dv.storage_path,
          'version_id', dv.id, 'record_hash', dv.record_hash,
          'caricato_da', pr.email,
          'caricato_at', to_char(dv.uploaded_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ) as e,
        dv.file_name
      from public.deliverables d
      join public.deliverable_versions dv on dv.deliverable_id = d.id
      join public.profiles pr on pr.id = dv.uploaded_by
      where d.task_id = v_p.task_id and d.kind = 'immagini_montaggio'
    ) x
  ), '[]'::jsonb);

  v_elementi := v_elementi || jsonb_build_array(
    jsonb_build_object(
      'ruolo', 'descrizione', 'tipo', 'testo',
      'sha256', encode(extensions.digest(v_p.descrizione, 'sha256'), 'hex'),
      'caratteri', length(v_p.descrizione), 'testo', v_p.descrizione
    ),
    jsonb_build_object(
      'ruolo', 'script', 'tipo', 'testo',
      'sha256', encode(extensions.digest(v_p.script, 'sha256'), 'hex'),
      'caratteri', length(v_p.script), 'testo', v_p.script
    ),
    jsonb_build_object(
      'ruolo', 'titolo_youtube', 'tipo', 'testo',
      'sha256', encode(extensions.digest(v_p.titolo_youtube, 'sha256'), 'hex'),
      'caratteri', length(v_p.titolo_youtube), 'testo', v_p.titolo_youtube
    )
  );

  v_manifest := jsonb_build_object(
    'versione_formato', 1,
    'emittente', 'ToothTalk — gestionale interno',
    'pacchetto_id', p_pacchetto,
    'task', jsonb_build_object('id', v_task.id, 'titolo', v_task.titolo),
    'polo', jsonb_build_object('id', v_polo.id, 'nome', v_polo.nome, 'citta', v_polo.citta),
    'sigillato_at', v_quando_s,
    'sigillato_da', jsonb_build_object('id', v_autore.id, 'email', v_autore.email, 'nome', v_autore.full_name),
    'elementi', v_elementi
  );

  v_hash := encode(extensions.digest(v_manifest::text, 'sha256'), 'hex');

  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'sigillato', manifest = v_manifest, manifest_hash = v_hash,
         sigillato_at = v_quando, sigillato_da = auth.uid()
   where id = p_pacchetto;
  update public.tasks
     set status = 'sigillato'
   where id = v_p.task_id;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), 'admin'::public.user_role,
          'sigillo_pacchetto', 'pacchetto_video', p_pacchetto, v_polo_id,
          jsonb_build_object('manifest_hash', v_hash, 'task_id', v_p.task_id));

  return v_manifest || jsonb_build_object('manifest_hash', v_hash);
end $$;
