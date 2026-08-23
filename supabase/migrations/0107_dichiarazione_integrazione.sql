-- =====================================================================
-- 0107_dichiarazione_integrazione.sql — video di integrazione della
--                                            dichiarazione (Protocollo 4.1)
-- =====================================================================
-- Protocollo Art. 4.1 "Domande non dichiarate": se durante l'intervista
-- emerge la necessità di porre una domanda non dichiarata nel video
-- iniziale, il Collaboratore DEVE integrare la dichiarazione con un nuovo
-- video che includa anche la domanda aggiuntiva, prima del sigillo.
--
-- Questa migrazione:
--   1. apre fn_elemento_coerente anche al ruolo 'dichiarazione_integrazione'
--      (stessa regola di 'dichiarazione_identita': punta a video_grezzo/audio
--      del bucket originali, visibilità ristretta a chi l'ha caricato +
--      Titolare — nessun cambiamento di RLS, il meccanismo 0091 copre già
--      ogni video/audio grezzo di un task con terzi coinvolti);
--   2. ricrea sigilla_pacchetto (l'integrazione è ADDITIVA: l'elemento, se
--      presente, entra automaticamente nel manifesto e nella PEC; il sigillo
--      continua a richiedere solo la dichiarazione di identità iniziale —
--      il sistema non può sapere se c'è stata una domanda imprevista, la
--      verifica di copertura domande/script resta l'onere editoriale del
--      Coordinatore). Corregge anche il messaggio d'errore della dichiarazione
--      mancante, rimasto al tempo in cui il file si marcava dai materiali di
--      lavorazione (oggi si carica dall'apposito slot in "Video completo");
--   3. aggiunge la colonna 'ruolo' a richieste_ricaricamento_dichiarazione
--      così il flusso "Segnala errore" sa QUALE dei due video va liberato.
-- =====================================================================

-- ------------------------------------------------ 1. coerenza elementi

create or replace function public.fn_elemento_coerente()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task_pacchetto uuid;
  v_task_versione  uuid;
  v_origin public.version_origin;
  v_bucket text;
  v_kind   text;
begin
  select task_id into v_task_pacchetto from public.pacchetti_video where id = new.pacchetto_id;

  select d.task_id, v.origin, v.bucket, d.kind
    into v_task_versione, v_origin, v_bucket, v_kind
  from public.deliverable_versions v
  join public.deliverables d on d.id = v.deliverable_id
  where v.id = new.version_id;

  if v_task_versione is distinct from v_task_pacchetto then
    raise exception 'Il file non appartiene a questo progetto' using errcode = '42501';
  end if;

  -- Le dichiarazioni (di identità e di integrazione, Art. 4.1 Protocollo)
  -- sono gli unici elementi che puntano al grezzo (video_grezzo/audio del
  -- bucket originali), non a un materiale finale.
  if new.ruolo in ('dichiarazione_identita', 'dichiarazione_integrazione') then
    if v_origin <> 'originale' or v_bucket <> 'originali' or v_kind not in ('video_grezzo', 'audio') then
      raise exception 'Le dichiarazioni devono puntare a un video o audio grezzo (bucket originali)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if v_origin <> 'originale' or v_bucket <> 'finali' then
    raise exception 'Nel video completo entrano solo i file caricati come materiale finale'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------- 2. sigillo

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

  -- Revoca del consenso (Accordo Art. 8.2/8.3): non si sigilla un pacchetto
  -- che ritrae un partecipante con consenso immagine/voce revocato o con una
  -- richiesta di rimozione del pubblicato APERTA.
  if exists (
    select 1
      from public.pacchetto_elementi pe
      join public.deliverable_versions v on v.id = pe.version_id
      join public.profiles p on p.id = v.uploaded_by
     where pe.pacchetto_id = p_pacchetto
       and (
         exists (select 1 from public.consensi c
                  where c.user_id = p.id and c.tipo = 'immagine_voce'
                    and c.revocato_at is not null)
         or exists (select 1 from public.richieste_rimozione_pubblicato rr
                     where rr.user_id = p.id and rr.stato = 'aperta')
       )
  ) then
    raise exception 'Impossibile sigillare: consenso immagine/voce revocato o richiesta di rimozione aperta per un partecipante in questo pacchetto — risolvi prima la richiesta di rimozione';
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
  if v_coinvolge_terzi and not exists (
    select 1 from public.pacchetto_elementi
    where pacchetto_id = p_pacchetto and ruolo = 'dichiarazione_identita'
  ) then
    raise exception 'Il progetto coinvolge una persona esterna: manca il video di dichiarazione di identità e recapito (Art. 4.1 Protocollo) — caricalo dall''apposito slot in "Video completo"';
  end if;
  -- L'eventuale video di integrazione (Art. 4.1 "Domande non dichiarate") è
  -- un elemento ADDITIVO: se presente entra nel manifesto e nella PEC; la sua
  -- presenza non è richiesta dal sigillo (il sistema non può sapere se c'è
  -- stata una domanda imprevista — la verifica di copertura resta del
  -- Coordinatore).

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

-- --------------------------------- 3. richieste di ricaricamento: ruolo

alter table public.richieste_ricaricamento_dichiarazione
  add column if not exists ruolo text not null default 'dichiarazione_identita'
  check (ruolo in ('dichiarazione_identita', 'dichiarazione_integrazione'));

-- La guardia rende immutabili anche la colonna ruolo (come i dati originali).
create or replace function public.fn_ricar_dich_guard()
returns trigger language plpgsql as $$
begin
  if (new.user_id, new.pacchetto_id, new.ruolo, new.creato_at)
     is distinct from (old.user_id, old.pacchetto_id, old.ruolo, old.creato_at) then
    raise exception 'Una richiesta di ricaricamento non è modificabile nei suoi dati originali'
      using errcode = '42501';
  end if;
  if new.stato = 'risolta' and old.stato = 'aperta' then
    new.risolta_at := now();
    new.risolta_da := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_ricar_dich_guard on public.richieste_ricaricamento_dichiarazione;
create trigger trg_ricar_dich_guard
  before update on public.richieste_ricaricamento_dichiarazione
  for each row execute function public.fn_ricar_dich_guard();

