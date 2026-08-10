-- =====================================================================
-- 0032_pg_net.sql — estensione per chiamate HTTP asincrone dal database
-- =====================================================================
-- pg_net serve al trigger della migrazione 0033: quando un pacchetto
-- passa a 'da_fare', il database chiama la Edge Function esporta-drive.
-- Va applicata da sola, prima della 0033.
create extension if not exists pg_net with schema extensions;
