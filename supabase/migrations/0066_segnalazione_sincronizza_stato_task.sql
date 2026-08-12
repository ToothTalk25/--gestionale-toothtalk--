-- =====================================================================
-- 0066_segnalazione_sincronizza_stato_task.sql
-- Come il sigillo porta lo stato del progetto a 'sigillato' (0064), la
-- segnalazione di completamento del gruppo lo porta a 'in_revisione': la
-- pipeline visibile in cima alla pagina (In preparazione → Completato →
-- In revisione → Sigillato) si aggiorna da sola, non a forza di click.
-- =====================================================================

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
