-- =====================================================================
-- 0035_elimina_progetto.sql — eliminazione completa di un progetto
-- =====================================================================
-- I progetti si creano e si rinominano dal gruppo; l'eliminazione completa
-- è invece una decisione che richiede l'accesso globale: toglie tutto ciò
-- che il gruppo ha depositato (materiali di lavorazione e pacchetto).
--
-- Cosa NON si può mai eliminare:
--  - un progetto bloccato (locked);
--  - un progetto con un pacchetto già certificato via PEC (sigillato,
--    pec_inviata, pec_confermata, pec_errore) o annullato: la prova è
--    nelle caselle e il record resta a registro per sempre.
--
-- Un pacchetto in attesa di revisione ('pronto') torna prima in
-- composizione e poi viene eliminato insieme al progetto. Il registro
-- audit_log è append-only e non si tocca: l'eliminazione viene
-- registrata, non cancellata.
-- =====================================================================

-- ---------------------------------------------------------- difesa 0035
-- fn_pacchetto_no_delete nasceva (0006/0009) per bloccare OGNI
-- cancellazione di un pacchetto. Lo stesso principio delle tre difese
-- vale solo per ciò che è stato certificato: una bozza (o un pacchetto in
-- attesa di revisione) si può rimuovere, come già avviene per i file del
-- bucket finali fintanto che il pacchetto è in bozza (0014/0015/0016).
-- Il blocco resta totale per tutto ciò che ha valore probatorio.
create or replace function public.fn_pacchetto_no_delete()
returns trigger language plpgsql as $$
begin
  if old.stato not in ('bozza', 'pronto') then
    raise exception 'Pacchetto certificato via PEC: non si elimina, si può solo annullare'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists trg_pacchetto_no_delete on public.pacchetti_video;
create trigger trg_pacchetto_no_delete
  before delete on public.pacchetti_video
  for each row execute function public.fn_pacchetto_no_delete();

create or replace function public.elimina_progetto(p_task uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_polo      uuid;
  v_locked    boolean;
  v_pacchetto uuid;
  v_stato     public.pacchetto_stato;
begin
  select t.polo_id, t.locked into v_polo, v_locked
  from public.tasks t where t.id = p_task;

  if v_polo is null then
    raise exception 'Progetto inesistente';
  end if;

  if not public.is_admin() then
    raise exception 'Solo chi ha accesso globale può eliminare un progetto'
      using errcode = '42501';
  end if;

  if v_locked then
    raise exception 'Il progetto è bloccato: non può essere eliminato';
  end if;

  select id, stato into v_pacchetto, v_stato
  from public.pacchetti_video
  where task_id = p_task
  order by created_at desc
  limit 1;

  if v_pacchetto is not null and v_stato not in ('bozza', 'pronto') then
    raise exception
      'Il progetto contiene un pacchetto certificato via PEC: non può essere eliminato';
  end if;

  -- Un pacchetto in attesa di revisione torna in composizione, così i suoi
  -- elementi non sono più congelati e la cancellazione può procedere.
  if v_pacchetto is not null and v_stato = 'pronto' then
    perform set_config('app.sigillo_in_corso', '1', true);
    update public.pacchetti_video
       set stato = 'bozza', pronto_at = null
     where id = v_pacchetto;
    perform set_config('app.sigillo_in_corso', '0', true);
  end if;

  -- Ordine imposto dai vincoli di chiave esterna: i figli prima del padre.
  delete from public.richieste_modifica where task_id = p_task;
  -- Cancella il pacchetto: per cascata vanno pacchetto_elementi ed
  -- esportazioni_drive. A quel punto le versioni non sono più agganciate
  -- e fn_versions_append_only lascia passare la cancellazione.
  delete from public.pacchetti_video where task_id = p_task;
  delete from public.deliverable_versions dv
    using public.deliverables d
    where dv.deliverable_id = d.id and d.task_id = p_task;
  delete from public.deliverables where task_id = p_task;
  delete from public.task_status_history where task_id = p_task;
  delete from public.tasks where id = p_task;

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), 'admin'::public.user_role, 'eliminazione_progetto',
          'task', p_task, v_polo, jsonb_build_object());
end $$;

grant execute on function public.elimina_progetto(uuid) to authenticated;
