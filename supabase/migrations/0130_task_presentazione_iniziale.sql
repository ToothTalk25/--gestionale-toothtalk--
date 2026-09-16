-- =====================================================================
-- 0130_task_presentazione_iniziale.sql — un progetto "Presentazione del
-- team" creato automaticamente per ogni polo, appena nasce.
-- =====================================================================
-- Ogni nuovo team che entra nel progetto gira il video di benvenuto
-- (formato "presentazione_team", 0129): invece di lasciare che qualcuno
-- se ne ricordi e lo crei a mano, il progetto compare da solo appena il
-- polo viene inserito. created_by resta null (nessun utente umano lo ha
-- creato) — la colonna è nullable apposta (0001).
-- =====================================================================

create or replace function public.fn_crea_task_presentazione_iniziale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_formato_id uuid;
begin
  select id into v_formato_id from public.formati where slug = 'presentazione_team';

  if v_formato_id is not null then
    insert into public.tasks (polo_id, titolo, formato_id)
    values (new.id, 'Presentazione del team', v_formato_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_crea_task_presentazione_iniziale on public.poli;
create trigger trg_crea_task_presentazione_iniziale
  after insert on public.poli
  for each row
  execute function public.fn_crea_task_presentazione_iniziale();

-- ---------------------------------------------------------- backfill
-- I poli esistenti sono nati prima di questo trigger: gli si dà lo
-- stesso progetto ora, uno solo a testa, solo a chi non ce l'ha già.
insert into public.tasks (polo_id, titolo, formato_id)
select p.id, 'Presentazione del team', f.id
from public.poli p
cross join (select id from public.formati where slug = 'presentazione_team') f
where not exists (
  select 1 from public.tasks t
  where t.polo_id = p.id and t.formato_id = f.id
);
