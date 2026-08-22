-- =====================================================================
-- 0092_dichiarazione_in_pacchetto_enum.sql — nuovo valore di enum
-- =====================================================================
-- ATTENZIONE: eseguire QUESTO FILE DA SOLO, come 0012_enum_liberatoria.sql.
-- Postgres non permette di usare un valore di enum appena aggiunto nella
-- stessa transazione in cui è stato creato — l'uso di questo valore è
-- nella migrazione successiva (0093_dichiarazione_in_pacchetto.sql).
-- =====================================================================

alter type public.ruolo_elemento add value if not exists 'dichiarazione_identita';
