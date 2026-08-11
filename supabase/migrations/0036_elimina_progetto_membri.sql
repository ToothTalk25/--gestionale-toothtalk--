-- =====================================================================
-- 0036_elimina_progetto_membri.sql — eliminazione aperta ai membri
-- =====================================================================
-- L'eliminazione non è più riservata a chi ha accesso globale: qualsiasi
-- membro del gruppo può eliminare un progetto finché lo stato è
-- 'da_fare'. Dopo che il gruppo segnala "Completato" (consegnato) il
-- progetto diventa non eliminabile.
-- =====================================================================

create or replace function public.elimina_progetto(p_task uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_polo      uuid;
  v_locked    boolean;
  v_status    text;
  v_pacchetto uuid;
  v_stato_pk  public.pacchetto_stato;
begin
  select t.polo_id, t.locked, t.status::text
    into v_polo, v_locked, v_status
    from public.tasks t where t.id = p_task;

  if v_polo is null then
    raise exception 'Progetto inesistente';
  end if;

  -- Qualsiasi membro del polo può eliminare (non serve accesso globale).
  if not exists (
    select 1 from public.memberships
    where user_id = auth.uid() and polo_id = v_polo
  ) and not public.is_admin() then
    raise exception 'Non fai parte di questo gruppo'
      using errcode = '42501';
  end if;

  if v_locked then
    raise exception 'Il progetto è bloccato: non può essere eliminato';
  end if;

  if v_status <> 'da_fare' then
    raise exception 'Il progetto è già stato segnalato come completato: non può essere eliminato';
  end if;

  select id, stato into v_pacchetto, v_stato_pk
  from public.pacchetti_video
  where task_id = p_task
  order by created_at desc
  limit 1;

  if v_pacchetto is not null and v_stato_pk not in ('bozza', 'pronto') then
    raise exception
      'Il progetto contiene un pacchetto certificato via PEC: non può essere eliminato';
  end if;

  if v_pacchetto is not null and v_stato_pk = 'pronto' then
    perform set_config('app.sigillo_in_corso', '1', true);
    update public.pacchetti_video
       set stato = 'bozza', pronto_at = null
     where id = v_pacchetto;
    perform set_config('app.sigillo_in_corso', '0', true);
  end if;

  delete from public.richieste_modifica where task_id = p_task;
  delete from public.pacchetti_video where task_id = p_task;
  delete from public.deliverable_versions dv
    using public.deliverables d
    where dv.deliverable_id = d.id and d.task_id = p_task;
  delete from public.deliverables where task_id = p_task;
  delete from public.task_status_history where task_id = p_task;
  delete from public.tasks where id = p_task;

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(),
          case when public.is_admin() then 'admin'::public.user_role
               else 'member'::public.user_role end,
          'eliminazione_progetto', 'task', p_task, v_polo,
          jsonb_build_object());
end $$;
