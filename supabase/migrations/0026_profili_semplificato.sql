-- =====================================================================
-- 0026_profili_semplificato.sql — l'anagrafica si riduce all'essenziale
-- =====================================================================
-- Data e luogo di nascita non servono nel gestionale: sono dati sensibili
-- che stanno già nel contratto/accordo firmato. Nel profilo restano solo
-- nome, cognome e università.
-- =====================================================================

alter table public.profiles
  drop column if exists data_nascita,
  drop column if exists luogo_nascita;
