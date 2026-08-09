-- =====================================================================
-- 0010_kind_descrizione.sql — nuovo tipo di materiale grezzo: descrizione
-- =====================================================================
-- ATTENZIONE: eseguire QUESTO FILE DA SOLO (come 0005): Postgres non
-- permette di usare un valore di enum appena aggiunto nella stessa
-- transazione in cui è stato creato.
--
-- "audio" resta nel tipo per compatibilità (nessun dato lo usa ancora, ma
-- rimuovere un valore da un enum Postgres richiede di ricostruire l'intero
-- tipo): semplicemente non compare più fra le sezioni della UI.
-- =====================================================================

alter type public.deliverable_kind add value if not exists 'descrizione';
