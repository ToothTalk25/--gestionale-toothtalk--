-- =====================================================================
-- 0033_esportazioni_drive.sql — copia dei pacchetti sigillati su Google
--                              Drive, gestita fuori da Vercel
-- =====================================================================
-- Fino a 0032 l'esportazione su Drive avveniva dentro la server action
-- (Vercel): i file del pacchetto venivano scaricati dallo Storage e
-- ricaricati su Drive nella funzione serverless, consumandone banda,
-- memoria e tempo (e gonfiando il bundle con googleapis).
--
-- Da qui in poi il lavoro lo fa una Edge Function Supabase, chiamata dal
-- database appena un pacchetto passa a 'da_fare'. La riga di stato vive
-- qui, la Edge Function la aggiorna con la service role key. L'unica
-- scrittura consentita a chi naviga l'app è la RPC richiedi_esportazione_drive,
-- che ripete il controllo di accesso e riporta la riga a 'da_fare'
-- (prima richiesta o "Riprova" manuale).
--
-- Qui vivono SOLO i NOMI dei segreti (in vault): l'URL della Edge
-- Function e la chiave condivisa si popolano dopo, con un comando SQL a
-- parte, mai dentro la migrazione.
-- =====================================================================

-- -------------------------------------------------------------- tabella
create table if not exists public.esportazioni_drive (
  id                 uuid primary key default gen_random_uuid(),
  pacchetto_id       uuid not null unique references public.pacchetti_video(id) on delete cascade,
  stato              text not null default 'da_fare'
                     check (stato in ('da_fare', 'in_corso', 'fatto', 'errore')),
  cartella_drive_id  text,
  cartella_drive_url text,
  tentativi          integer not null default 0,
  ultimo_errore      text,
  creato_at          timestamptz not null default now(),
  aggiornato_at      timestamptz not null default now()
);

comment on table public.esportazioni_drive is
  'Stato della copia su Google Drive di un pacchetto sigillato. Una riga '
  'per pacchetto: da_fare → in_corso → fatto (o errore). Ci scrivono solo '
  'la Edge Function (service_role) e la RPC richiedi_esportazione_drive.';

-- ------------------------------------------------------------------ RLS
alter table public.esportazioni_drive enable row level security;

-- Lettura: chi ha accesso globale o è membro del gruppo del progetto.
drop policy if exists esportazioni_select on public.esportazioni_drive;
create policy esportazioni_select on public.esportazioni_drive
  for select to authenticated
  using (
    exists (
      select 1 from public.pacchetti_video p
      where p.id = pacchetto_id
        and public.can_read_polo(public.polo_of_task(p.task_id))
    )
  );

-- Nessuna scrittura diretta per il ruolo authenticated: l'unica strada è
-- la RPC dedicata (che ripete il controllo). La Edge Function passa con
-- la service role key, che ignora la RLS.
revoke insert, update, delete on public.esportazioni_drive from authenticated;

grant select on public.esportazioni_drive to authenticated;
grant select, insert, update on public.esportazioni_drive to service_role;


-- ------------------------------------------------------------ richiesta
-- Chiede (o richiede di nuovo) la copia su Drive di un pacchetto.
-- L'upsert a 'da_fare' fa scattare il trigger che avvisa la Edge Function.
create or replace function public.richiedi_esportazione_drive(p_pacchetto uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_polo uuid;
begin
  select t.polo_id into v_polo
  from public.pacchetti_video p
  join public.tasks t on t.id = p.task_id
  where p.id = p_pacchetto;

  if v_polo is null then
    raise exception 'Pacchetto inesistente';
  end if;

  if not (public.is_admin() or public.is_member_of(v_polo)) then
    raise exception 'Non appartieni al gruppo di questo progetto' using errcode = '42501';
  end if;

  insert into public.esportazioni_drive (pacchetto_id, stato)
  values (p_pacchetto, 'da_fare')
  on conflict (pacchetto_id) do update
    set stato = 'da_fare',
        ultimo_errore = null,
        aggiornato_at = now();
end $$;

grant execute on function public.richiedi_esportazione_drive(uuid) to authenticated;


-- ------------------------------------------------------------- avviso
-- Quando la riga passa a 'da_fare' (prima richiesta o "Riprova"), avvisa
-- la Edge Function. I segreti vivono in vault: se non esistono ancora la
-- funzione esce senza fare nulla — il pacchetto resta comunque 'da_fare'
-- e la copia parte appena l'esportatore esiste.
create or replace function public.fn_avvisa_esportazione_drive()
returns trigger
language plpgsql security definer set search_path = public, extensions, net as $$
declare
  v_url text;
  v_key text;
begin
  if new.stato <> 'da_fare' then
    return new;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'edge_function_drive_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'edge_function_drive_key';

  if v_url is null or v_key is null then
    -- Niente segreti: niente esportazione automatica. Non è un errore:
    -- il sistema funziona comunque, e la copia riparte quando si
    -- configurano i segreti (o con il "Riprova" manuale).
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('pacchetto_id', new.pacchetto_id)::text
  );

  return new;
end $$;

drop trigger if exists trg_esportazione_avviso on public.esportazioni_drive;
create trigger trg_esportazione_avviso
  after insert or update of stato on public.esportazioni_drive
  for each row execute function public.fn_avvisa_esportazione_drive();


-- ----------------------------------------------- estensione registra_esito_pec
-- Mantiene tutto il comportamento di 0006 e aggiunge: quando la PEC
-- risulta inviata, il pacchetto viene accodato alla copia su Drive
-- (upsert a 'da_fare', che fa scattare il trigger di avviso).
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

  -- PEC realmente spedita: il pacchetto va copiato su Drive in background.
  if p_stato = 'pec_inviata' then
    insert into public.esportazioni_drive (pacchetto_id, stato)
    values (p_pacchetto, 'da_fare')
    on conflict (pacchetto_id) do update
      set stato = 'da_fare',
          ultimo_errore = null,
          aggiornato_at = now();
  end if;

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), null, 'pec_' || p_stato::text, 'pacchetto_video', p_pacchetto, v_polo,
          jsonb_build_object('message_id', p_message_id, 'errore', p_errore));
end $$;

-- I permessi restano quelli di 0006: la funzione la chiama SOLO il server,
-- con la service role key, dopo una spedizione realmente avvenuta.
revoke execute on function
  public.registra_esito_pec(uuid, public.pacchetto_stato, text, text[], text, text)
  from public, anon, authenticated;
grant execute on function
  public.registra_esito_pec(uuid, public.pacchetto_stato, text, text[], text, text)
  to service_role;
