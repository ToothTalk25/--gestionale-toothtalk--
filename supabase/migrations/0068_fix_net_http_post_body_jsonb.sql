-- =====================================================================
-- 0068_fix_net_http_post_body_jsonb.sql
--
-- Bug trovato durante un test reale: entrambi i trigger che avvisano le
-- Edge Function tramite net.http_post passavano 'body' castato a ::text,
-- ma la versione di pg_net installata (0.20.4) ha la firma
-- http_post(url text, body jsonb, params jsonb, headers jsonb,
-- timeout_milliseconds integer) — 'body' è jsonb, non text. La chiamata
-- falliva sempre con "function net.http_post(...) does not exist",
-- interrompendo silenziosamente (o peggio, sollevando un'eccezione dentro
-- una transazione più ampia) sia l'esportazione su Drive del pacchetto
-- sigillato sia la sincronizzazione delle immagini di montaggio (Genova).
-- Probabile eredità di una versione precedente di pg_net dove 'body' era
-- text, mai aggiornata dopo l'upgrade dell'estensione.
-- =====================================================================

create or replace function public.fn_avvisa_esportazione_drive()
returns trigger
language plpgsql security definer set search_path = public, extensions, net as $function$
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
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object('pacchetto_id', new.pacchetto_id)
  );

  return new;
end $function$;

create or replace function public.fn_avvisa_immagine_montaggio()
returns trigger
language plpgsql security definer set search_path = public, extensions, net as $function$
declare
  v_kind      public.deliverable_kind;
  v_task      uuid;
  v_titolo    text;
  v_numero    integer;
  v_polo      uuid;
  v_cartella  text;
  v_url       text;
  v_key       text;
begin
  select d.kind, d.task_id into v_kind, v_task
  from public.deliverables d where d.id = new.deliverable_id;

  if v_kind <> 'immagini_montaggio' then
    return new;
  end if;

  select t.titolo, t.numero_video, t.polo_id into v_titolo, v_numero, v_polo
  from public.tasks t where t.id = v_task;

  select p.drive_immagini_montaggio_folder_id into v_cartella
  from public.poli p where p.id = v_polo;

  if v_cartella is null then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets
  where name = 'edge_function_immagini_url';
  select decrypted_secret into v_key from vault.decrypted_secrets
  where name = 'edge_function_immagini_key';

  if v_url is null or v_key is null then return new; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json',
                                   'Authorization','Bearer ' || v_key),
    body := jsonb_build_object(
      'version_id', new.id,
      'numero_video', v_numero,
      'titolo', v_titolo,
      'cartella_drive_id', v_cartella
    )
  );
  return new;
end $function$;
