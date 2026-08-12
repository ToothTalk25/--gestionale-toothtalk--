-- =====================================================================
-- 0063_richieste_da_verificare.sql
--
-- "Segna come fatta" oggi chiude la richiesta in un solo passaggio, anche
-- quando è il gruppo a cliccarla: chi ha aperto la richiesta (l'admin) non
-- vede mai cosa è stato effettivamente cambiato, la trova già "risolta".
-- Si introduce un passaggio intermedio: quando il gruppo segnala di aver
-- corretto, la richiesta passa a 'da_verificare' (non 'risolta'). Solo
-- l'admin, dopo aver controllato, la conferma come risolta — o la riapre se
-- non va ancora bene. Se è l'admin stesso a segnalarla fatta (es. l'ha
-- corretta lui), si chiude direttamente: non deve confermare a se stesso.
-- =====================================================================

alter type public.richiesta_stato add value if not exists 'da_verificare' after 'aperta';

alter table public.richieste_modifica
  add column if not exists completata_da uuid references public.profiles(id),
  add column if not exists completata_at timestamptz;

comment on column public.richieste_modifica.completata_da is
  'Chi (di solito nel gruppo) ha segnalato di aver corretto — non è ancora la conferma finale.';
comment on column public.richieste_modifica.risolta_da is
  'Chi ha confermato la richiesta come davvero risolta (l''admin che l''aveva aperta, o chi corregge se è admin).';

create or replace function public.segna_richiesta_fatta(p_richiesta uuid, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_r public.richieste_modifica%rowtype;
begin
  select * into v_r from public.richieste_modifica where id = p_richiesta for update;
  if not found then
    raise exception 'Richiesta inesistente';
  end if;
  if v_r.stato <> 'aperta' then
    raise exception 'Questa richiesta non è aperta (stato: %)', v_r.stato;
  end if;
  if not (public.is_admin() or public.is_member_of(public.polo_of_task(v_r.task_id))) then
    raise exception 'Non appartieni al gruppo di questo progetto' using errcode = '42501';
  end if;

  if public.is_admin() then
    update public.richieste_modifica
       set stato = 'risolta', risolta_da = auth.uid(), risolta_at = now(),
           nota_risposta = coalesce(nullif(btrim(p_nota), ''), nota_risposta)
     where id = p_richiesta;
  else
    update public.richieste_modifica
       set stato = 'da_verificare', completata_da = auth.uid(), completata_at = now(),
           nota_risposta = coalesce(nullif(btrim(p_nota), ''), nota_risposta)
     where id = p_richiesta;
  end if;
end $$;

grant execute on function public.segna_richiesta_fatta(uuid, text) to authenticated;

create or replace function public.conferma_richiesta(p_richiesta uuid, p_ok boolean, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_r public.richieste_modifica%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Operazione riservata a chi ha accesso globale' using errcode = '42501';
  end if;

  select * into v_r from public.richieste_modifica where id = p_richiesta for update;
  if not found then
    raise exception 'Richiesta inesistente';
  end if;
  if v_r.stato <> 'da_verificare' then
    raise exception 'Questa richiesta non è in attesa di conferma (stato: %)', v_r.stato;
  end if;

  if p_ok then
    update public.richieste_modifica
       set stato = 'risolta', risolta_da = auth.uid(), risolta_at = now(),
           nota_risposta = coalesce(nullif(btrim(p_nota), ''), nota_risposta)
     where id = p_richiesta;
  else
    update public.richieste_modifica
       set stato = 'aperta', completata_da = null, completata_at = null,
           nota_risposta = coalesce(nullif(btrim(p_nota), ''), nota_risposta)
     where id = p_richiesta;
  end if;
end $$;

grant execute on function public.conferma_richiesta(uuid, boolean, text) to authenticated;

-- Una richiesta "da verificare" blocca il sigillo/la segnalazione tanto
-- quanto una "aperta": non è ancora confermata come risolta.
create or replace function public.segnala_completato(p_pacchetto uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p                    public.pacchetti_video%rowtype;
  v_polo                 uuid;
  v_coinvolge_terzi      boolean;
  v_esito_video          text;
  v_esito_copertina      text;
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

  select t.coinvolge_terzi into v_coinvolge_terzi from public.tasks t where t.id = v_p.task_id;

  select esito into v_esito_video
  from public.verifiche_riconoscimento
  where pacchetto_id = p_pacchetto and ruolo = 'video'
  order by creato_at desc limit 1;

  select esito into v_esito_copertina
  from public.verifiche_riconoscimento
  where pacchetto_id = p_pacchetto and ruolo = 'copertina'
  order by creato_at desc limit 1;

  if not v_coinvolge_terzi
     and (v_esito_video = 'persona_non_riconosciuta' or v_esito_copertina = 'persona_non_riconosciuta')
  then
    raise exception 'Il controllo automatico ha rilevato % una persona che non corrisponde a nessun membro del gruppo. Se è presente una persona esterna, spunta "Il video mostra una persona esterna" e invita quella persona a firmare la liberatoria: senza liberatoria firmata non è possibile procedere.',
      case
        when v_esito_video = 'persona_non_riconosciuta' and v_esito_copertina = 'persona_non_riconosciuta' then 'nel video e nella copertina'
        when v_esito_video = 'persona_non_riconosciuta' then 'nel video'
        else 'nella copertina'
      end;
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

create or replace function public.sigilla_pacchetto(p_pacchetto uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_p                 public.pacchetti_video%rowtype;
  v_polo_id           uuid;
  v_coinvolge_terzi   boolean;
  v_script_richiesto  text;
  v_task              record;
  v_polo              record;
  v_autore            record;
  v_elementi          jsonb;
  v_manifest          jsonb;
  v_hash              text;
  v_quando            timestamptz := now();
  v_quando_s          text;
  v_esito_video       text;
  v_esito_copertina   text;
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

  select esito into v_esito_video
  from public.verifiche_riconoscimento
  where pacchetto_id = p_pacchetto and ruolo = 'video'
  order by creato_at desc limit 1;

  select esito into v_esito_copertina
  from public.verifiche_riconoscimento
  where pacchetto_id = p_pacchetto and ruolo = 'copertina'
  order by creato_at desc limit 1;

  if not v_coinvolge_terzi
     and (v_esito_video = 'persona_non_riconosciuta' or v_esito_copertina = 'persona_non_riconosciuta')
  then
    raise exception 'Il controllo automatico ha rilevato una possibile persona esterna non dichiarata (%): spunta "coinvolge terzi" o correggi manualmente prima di sigillare.',
      case
        when v_esito_video = 'persona_non_riconosciuta' and v_esito_copertina = 'persona_non_riconosciuta' then 'video e copertina'
        when v_esito_video = 'persona_non_riconosciuta' then 'video'
        else 'copertina'
      end;
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
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), 'admin'::public.user_role,
          'sigillo_pacchetto', 'pacchetto_video', p_pacchetto, v_polo_id,
          jsonb_build_object('manifest_hash', v_hash, 'task_id', v_p.task_id));

  return v_manifest || jsonb_build_object('manifest_hash', v_hash);
end $$;
