-- =====================================================================
-- 0040_avviso_immagine_montaggio_drive.sql — copia automatica su Drive
-- =====================================================================
-- Ogni volta che si carica un'immagine nella deliverable "immagini_montaggio",
-- se il polo di appartenenza ha configurato una cartella Drive, il trigger
-- chiama la Edge Function che copia il file nella sottocartella
-- "Video N — Titolo".
-- =====================================================================
create or replace function public.fn_avvisa_immagine_montaggio()
returns trigger
language plpgsql security definer set search_path = public, extensions, net as $$
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
    )::text
  );
  return new;
end $$;

drop trigger if exists trg_avvisa_immagine_montaggio on public.deliverable_versions;
create trigger trg_avvisa_immagine_montaggio
  after insert on public.deliverable_versions
  for each row execute function public.fn_avvisa_immagine_montaggio();
