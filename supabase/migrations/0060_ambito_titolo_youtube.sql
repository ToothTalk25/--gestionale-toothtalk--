-- =====================================================================
-- 0060_ambito_titolo_youtube.sql
-- "Richiedi modifica" copriva video/copertina/descrizione/script/generale
-- ma non il titolo YouTube Shorts, aggiunto in una fase successiva del
-- pacchetto pubblicabile: lo si aggiunge come ambito selezionabile.
-- =====================================================================

alter type public.ambito_richiesta add value if not exists 'titolo_youtube';
