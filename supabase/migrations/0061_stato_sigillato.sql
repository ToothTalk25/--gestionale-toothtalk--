-- =====================================================================
-- 0061_stato_sigillato.sql
-- Aggiunge 'sigillato' allo stato manuale del progetto (task_status),
-- per rispecchiare nell'etichetta libera anche il sigillo del pacchetto.
-- =====================================================================

alter type public.task_status add value if not exists 'sigillato' before 'pubblicato';
