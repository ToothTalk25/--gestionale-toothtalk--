-- =====================================================================
-- 0048_consenso_riconoscimento.sql
-- Aggiunge il tipo 'riconoscimento_foto' ai consensi: chi lo dà autorizza
-- il sistema a usare la propria foto profilo per il confronto automatico
-- IA (Fase D). Chi non lo dà viene escluso dal confronto.
-- =====================================================================

alter table public.consensi drop constraint if exists consensi_tipo_check;
alter table public.consensi add constraint consensi_tipo_check
  check (tipo in ('privacy', 'cookie', 'riconoscimento_foto'));

comment on constraint consensi_tipo_check on public.consensi is
  'riconoscimento_foto: consenso a usare la foto profilo per il confronto '
  'automatico nel controllo IA sui video (Fase D) — chi non lo dà viene '
  'escluso dal confronto, la sua foto resta privata per quello scopo.';
