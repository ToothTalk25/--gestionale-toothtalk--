-- =====================================================================
-- 0018_stato_pronto.sql — nuovo stato del pacchetto: 'pronto'
-- =====================================================================
-- Aggiunge 'pronto' all'enum pacchetto_stato. È il momento in cui il gruppo
-- segnala che il video completo è terminato e passa la mano a chi ha accesso
-- globale, che rivede il materiale e decide se sigillarlo o rimandarlo in
-- composizione.
--
-- Regola del progetto: i file che aggiungono valori a un enum vanno eseguiti
-- da soli — Postgres non permette di usare un valore di enum nella stessa
-- transazione in cui è stato creato. Questo file contiene SOLO l'aggiunta;
-- l'uso del nuovo stato arriva in 0019.
-- =====================================================================

alter type public.pacchetto_stato add value if not exists 'pronto';
