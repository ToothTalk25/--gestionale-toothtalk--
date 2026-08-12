-- =====================================================================
-- 0054_vista_pacchetti_da_archiviare.sql
-- Vista che elenca i pacchetti sigillati con file ancora da archiviare
-- (cioè file su Supabase Storage non ancora rimossi dopo la PEC).
-- =====================================================================

create or replace view public.v_pacchetti_da_archiviare
with (security_invoker = true) as
select
  p.id                  as pacchetto_id,
  p.task_id,
  t.titolo              as progetto,
  pl.nome               as gruppo,
  p.stato,
  p.sigillato_at,
  count(dv.id)          as file_da_archiviare
from public.pacchetti_video p
join public.tasks t on t.id = p.task_id
join public.poli pl on pl.id = t.polo_id
join public.pacchetto_elementi pe on pe.pacchetto_id = p.id
join public.deliverable_versions dv on dv.id = pe.version_id
where p.stato in ('sigillato', 'pec_inviata', 'pec_confermata')
  and dv.bucket = 'finali'
  and dv.archiviato_esterno = false
group by p.id, t.titolo, pl.nome, p.stato, p.sigillato_at;

grant select on public.v_pacchetti_da_archiviare to authenticated;
