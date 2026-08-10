-- =====================================================================
-- 0029_pec_partecipanti.sql — ogni partecipante ha la propria PEC
-- =====================================================================
-- Passaggio al modello PEC-to-PEC: ogni partecipante dichiara la propria
-- casella PEC. L'accordo firmato e le impronte dei materiali viaggiano via
-- PEC verso tutte le caselle certificate, così la consegna è certificata
-- (avvenuta consegna) per ciascuno, non solo per chi spedisce.
-- =====================================================================

alter table public.profiles
  add column if not exists pec text;

comment on column public.profiles.pec is
  'Casella PEC del partecipante: obbligatoria. Usata per inviare via PEC '
  'l''accordo firmato e le impronte dei materiali depositati.';
