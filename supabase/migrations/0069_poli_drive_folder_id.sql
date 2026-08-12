-- =====================================================================
-- 0069_poli_drive_folder_id.sql
--
-- Bug trovato durante lo stesso test reale della 0068: la Edge Function
-- esporta-drive legge "poli.drive_folder_id" (cartella Drive fissa e
-- opzionale per il polo — se assente, la funzione ne trova o crea una per
-- nome sotto la cartella radice), ma questa colonna non è mai stata creata:
-- esiste solo "drive_immagini_montaggio_folder_id" (tutt'altra cosa, solo
-- per la sincronizzazione immagini di Genova). La query falliva sempre,
-- quindi l'esportazione su Drive non ha mai funzionato, in nessun caso.
-- =====================================================================

alter table public.poli
  add column if not exists drive_folder_id text;

comment on column public.poli.drive_folder_id is
  'ID cartella Drive fissa per il polo (opzionale). Se assente, esporta-drive '
  'trova o crea una cartella con il nome del polo sotto GOOGLE_DRIVE_ROOT_FOLDER.';
