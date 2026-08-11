-- =====================================================================
-- 0039_tasks_numero_video.sql — contatore video manuale + protezione
-- =====================================================================
alter table public.tasks
  add column if not exists numero_video integer;

comment on column public.tasks.numero_video is
  'Numero video assegnato manualmente da chi ha accesso globale, usato per '
  'nominare le cartelle Drive. Nessun auto-incremento.';

-- Riproduce fn_tasks_guard (ultima versione: 0009) e aggiunge la protezione
-- di numero_video: come note_admin e published_url, è un campo che solo chi
-- ha accesso globale può modificare. Gli altri lo vedono, ma i loro update
-- mantengono il valore esistente (ignorato silenziosamente).
create or replace function public.fn_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_service_role()) then
    if old.locked then
      raise exception 'Progetto bloccato: contenuti non modificabili'
        using errcode = '42501';
    end if;
    if new.polo_id is distinct from old.polo_id then
      raise exception 'Non puoi spostare un progetto su un altro polo' using errcode = '42501';
    end if;
    if new.locked is distinct from old.locked then
      raise exception 'Blocco e sblocco del progetto non disponibili da qui' using errcode = '42501';
    end if;
    if new.status not in ('da_fare', 'consegnato', 'in_revisione') then
      raise exception 'Stato \"%\" non impostabile da qui', new.status using errcode = '42501';
    end if;
    -- campi di competenza esclusiva dell'accesso globale: ignorati silenziosamente
    new.note_admin    := old.note_admin;
    new.numero_video  := old.numero_video;
    new.published_url := old.published_url;
  end if;
  new.updated_at := now();
  return new;
end $$;
