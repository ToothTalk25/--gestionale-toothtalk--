-- =====================================================================
-- 0009_progetto_wording_genova.sql
-- =====================================================================
-- Tre cose scollegate, unite qui solo perché piccole:
--
-- 1. Terminologia: "task" nell'interfaccia si chiama "progetto".
--
-- 2. Nessuna etichetta di ruolo organizzativo ("Titolare") in nessun testo
--    rivolto all'utente. I messaggi d'errore sollevati dai trigger arrivano
--    all'utente testo per testo (la action fallita() in src/app/actions.ts
--    inoltra il messaggio grezzo per qualunque eccezione che non provenga
--    dalla RLS), quindi vanno riscritti qui, non solo nella UI React: si
--    descrive la restrizione ("questa azione non è disponibile da qui"),
--    mai il ruolo di chi potrebbe farla.
--
-- 3. Genova è un polo reale: era stato tolto per errore in 0007 (lì era
--    trattato come segnaposto non confermato). Lo si reinserisce.
--
-- Nessuna modifica di schema: si ridefiniscono funzioni già esistenti
-- (create or replace, sicuro anche se già applicate), si aggiornano i
-- commenti di schema (comment on, idempotenti) e si fa un insert
-- idempotente sui poli.
-- =====================================================================

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
      raise exception 'Stato "%" non impostabile da qui', new.status using errcode = '42501';
    end if;
    -- campi di competenza esclusiva dell'accesso globale: ignorati silenziosamente
    new.note_admin    := old.note_admin;
    new.published_url := old.published_url;
  end if;
  new.updated_at := now();
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
    raise exception 'Nel pacchetto pubblicabile entrano solo consegne del team caricate come materiale finale'
      using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.fn_protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il ruolo di un utente non è modificabile da qui' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.fn_pacchetto_no_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Un pacchetto non si cancella: può solo essere annullato'
    using errcode = '42501';
end $$;

create or replace function public.annulla_pacchetto(p_pacchetto uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Annullamento di un pacchetto non disponibile da qui' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Indica il motivo dell''annullamento';
  end if;

  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'annullato', annullato_motivo = p_motivo
   where id = p_pacchetto;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, meta)
  values (auth.uid(), 'admin', 'annullamento_pacchetto', 'pacchetto_video', p_pacchetto,
          jsonb_build_object('motivo', p_motivo));
end $$;

comment on column public.profiles.role is
  'Ruolo GLOBALE. admin = accesso trasversale a tutti i poli. member = componente di uno o più poli.';

comment on table public.deliverable_versions is
  'Archivio di tutela legale. origin=originale è la consegna del team ed è immutabile; '
  'origin=admin_edit è la rielaborazione successiva. Le due non si sovrascrivono mai.';

insert into public.poli (nome, slug, citta) values
  ('Genova', 'genova', 'Genova')
on conflict (slug) do update set citta = excluded.citta;
