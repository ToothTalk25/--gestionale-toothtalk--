-- =====================================================================
-- 0044_contatto_esterno_pec.sql — doppio canale: email o PEC
-- =====================================================================
alter table public.tasks
  add column if not exists contatto_esterno_pec text;

comment on column public.tasks.contatto_esterno_pec is
  'PEC del contatto esterno. Se valorizzata, la richiesta di liberatoria '
  'parte via PEC (mittente: toothtalk@pec.it) invece che via email ordinaria. '
  'Serve per i professionisti che hanno una casella PEC e vogliono data certa '
  'anche sull''invito.';
