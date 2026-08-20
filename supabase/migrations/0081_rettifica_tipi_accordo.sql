-- =====================================================================
-- 0081_rettifica_tipi_accordo.sql — ripristino accordo unico
-- =====================================================================
-- La 0080 aveva introdotto la distinzione front_man/backstage per
-- l'accordo editoriale. Rettifica: l'accordo è UNO SOLO per tutti i
-- collaboratori (la cessione dei diritti di immagine e autore è già
-- nell'Art. 4 del documento unico). on_screen resta rilevante solo per
-- la revoca GDPR (0078/0079), non per quale accordo si firma.
--
-- Quindi:
--   1. il check su consents_and_releases.tipo torna a quello originale
--      ('liberatoria','accordo_collaboratore','nda');
--   2. le colonne di valutazione dell'accordo introdotte dalla 0080
--      vengono rimosse: il flusso di approvazione riguarda la
--      REGISTRAZIONE (approvato_at/approvato_da), non l'accordo.
-- =====================================================================

alter table public.consents_and_releases
  drop constraint if exists consents_and_releases_tipo_check;

alter table public.consents_and_releases
  add constraint consents_and_releases_tipo_check
  check (tipo in ('liberatoria', 'accordo_collaboratore', 'nda'));

alter table public.consents_and_releases
  drop column if exists valutazione_admin;

alter table public.consents_and_releases
  drop column if exists valutato_da;

alter table public.consents_and_releases
  drop column if exists valutato_at;
