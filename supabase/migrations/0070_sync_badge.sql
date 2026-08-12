-- =====================================================================
-- 0070_sync_badge.sql — coerenza badge stato task ⇄ pacchetto
-- =====================================================================
-- Due badge dello stesso progetto non devono mai dire cose diverse.
-- 1) "Rimanda in composizione" portava il pacchetto a 'bozza' ma lasciava
--    tasks.status fermo a 'in_revisione' (il badge in cima alla pagina e
--    sulla pagina polo/dashboard diceva ancora "in revisione").
-- 2) "Annulla pacchetto" lasciava tasks.status allo stato precedente
--    (es. 'sigillato') mentre il pacchetto mostrava "annullato".
-- 3) v_video_da_rivedere.richieste_aperte contava solo le richieste
--    'aperta', ignorando 'da_verificare' che blocca altrettanto: il badge
--    "N da correggere" in /revisione e su /polo sottostimava.
-- =====================================================================

create or replace function public.rimanda_in_composizione(p_pacchetto uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p   public.pacchetti_video%rowtype;
  v_polo uuid;
begin
  select * into v_p from public.pacchetti_video where id = p_pacchetto for update;
  if not found then
    raise exception 'Pacchetto inesistente';
  end if;

  if not public.is_admin() then
    raise exception 'Solo chi ha accesso globale può rimettere in composizione un pacchetto'
      using errcode = '42501';
  end if;

  if v_p.stato <> 'pronto' then
    raise exception 'Si rimette in composizione solo un pacchetto in attesa di revisione (stato: %)',
      v_p.stato;
  end if;

  v_polo := public.polo_of_task(v_p.task_id);
  perform set_config('app.sigillo_in_corso', '1', true);
  update public.pacchetti_video
     set stato = 'bozza', pronto_at = null
   where id = p_pacchetto;
  update public.tasks
     set status = 'da_fare'
   where id = v_p.task_id;
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (auth.uid(), 'admin'::public.user_role, 'riapertura_composizione',
          'pacchetto_video', p_pacchetto, v_polo,
          jsonb_build_object('task_id', v_p.task_id));
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
  -- Il progetto torna componibile: il badge di stato deve tornare a
  -- "da fare" insieme al pacchetto "annullato", non restare a "sigillato".
  update public.tasks
     set status = 'da_fare'
   where id = (select task_id from public.pacchetti_video where id = p_pacchetto);
  perform set_config('app.sigillo_in_corso', '0', true);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, meta)
  values (auth.uid(), 'admin', 'annullamento_pacchetto', 'pacchetto_video', p_pacchetto,
          jsonb_build_object('motivo', p_motivo));
end $$;

-- Le richieste 'da_verificare' bloccano il completamento quanto le 'aperte':
-- il contatore visibile deve contarle entrambe.
create or replace view public.v_video_da_rivedere
with (security_invoker = true) as
select
  p.id                as pacchetto_id,
  p.task_id,
  t.titolo            as progetto,
  pl.id               as polo_id,
  pl.nome             as gruppo,
  p.stato,
  p.sigillato_at,
  p.pec_inviata_at,
  t.coinvolge_terzi,
  count(r.id) filter (where r.stato in ('aperta', 'da_verificare')) as richieste_aperte,
  max(r.creata_at)                              as ultima_richiesta
from public.pacchetti_video p
join public.tasks t on t.id = p.task_id
join public.poli  pl on pl.id = t.polo_id
left join public.richieste_modifica r on r.pacchetto_id = p.id
where p.stato <> 'bozza'
group by p.id, t.titolo, pl.id, pl.nome, t.coinvolge_terzi;

grant select on public.v_video_da_rivedere to authenticated;
