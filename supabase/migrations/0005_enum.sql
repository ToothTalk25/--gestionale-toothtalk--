-- =====================================================================
-- 0005_enum.sql — nuovi valori di enum
-- =====================================================================
-- ATTENZIONE: eseguire QUESTO FILE DA SOLO, prima di 0006.
-- Postgres non permette di usare un valore di enum appena aggiunto nella
-- stessa transazione in cui è stato creato; tenerlo separato evita
-- l'errore "unsafe use of new value of enum type".
-- =====================================================================

-- Materiali che compongono il pacchetto pubblicabile (≠ materiali di lavorazione).
alter type public.deliverable_kind add value if not exists 'finale_video';
alter type public.deliverable_kind add value if not exists 'finale_copertina';
