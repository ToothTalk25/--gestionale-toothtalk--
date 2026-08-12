-- =====================================================================
-- 0057_vista_polo_overview.sql — conteggio progetti per stato pacchetto
-- =====================================================================

create or replace view public.v_polo_overview
with (security_invoker = true) as
select
  pl.id as polo_id,
  pl.nome as polo_nome,
  count(t.id) as progetti_totali,
  count(t.id) filter (
    where p.id is null or p.stato = 'bozza'
  ) as in_lavorazione,
  count(t.id) filter (where p.stato = 'pronto') as in_attesa_revisione,
  count(t.id) filter (where p.stato in ('sigillato', 'pec_inviata', 'pec_confermata')) as sigillati,
  count(t.id) filter (where p.stato = 'pec_errore') as pec_errore
from public.poli pl
left join public.tasks t on t.polo_id = pl.id
left join public.pacchetti_video p on p.task_id = t.id and p.stato <> 'annullato'
group by pl.id, pl.nome;

grant select on public.v_polo_overview to authenticated;
