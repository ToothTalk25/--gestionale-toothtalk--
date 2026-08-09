-- =====================================================================
-- 0012_enum_liberatoria.sql — nuovi valori di enum per la liberatoria
--                              condizionale nel pacchetto pubblicabile
-- =====================================================================
-- ATTENZIONE: eseguire QUESTO FILE DA SOLO, come 0005 e 0010. Postgres non
-- permette di usare un valore di enum appena aggiunto nella stessa
-- transazione in cui è stato creato.
-- =====================================================================

alter type public.ruolo_elemento add value if not exists 'liberatoria';
alter type public.deliverable_kind add value if not exists 'finale_liberatoria';
