-- =====================================================================
-- 0102_drop_richieste_recesso.sql — rimozione del flusso recesso orfano
-- =====================================================================
-- richiediRecesso() (server action) e la tabella richieste_recesso (0085)
-- non erano raggiungibili da nessuna UI: nessun bottone le chiamava e
-- nessuna pagina admin le leggeva. Decisione del Titolare (vedi nota
-- legale): il flusso viene RIMOSSO perché superato da terminaCollaborazione
-- (uscita gestita dal Coordinatore) e revocaImmagineVoce (revoca del
-- consenso, con revisione manuale del grezzo). Nessun codice lo usava.
-- =====================================================================

drop table if exists public.richieste_recesso;
