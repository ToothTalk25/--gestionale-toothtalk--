-- =====================================================================
-- 0053_google_doc_url.sql — link a Google Docs per script e descrizione
-- =====================================================================
-- Script e descrizione di lavorazione sono documenti collaborativi
-- (Google Docs), non file binari da caricare. L'URL del documento
-- viene salvato qui e aperto dal gestionale.
-- =====================================================================

alter table public.deliverables
  add column if not exists google_doc_url text;
