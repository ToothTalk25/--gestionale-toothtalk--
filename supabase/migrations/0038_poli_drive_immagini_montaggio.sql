-- =====================================================================
-- 0038_poli_drive_immagini_montaggio.sql — cartella Drive per immagini
-- =====================================================================
alter table public.poli
  add column if not exists drive_immagini_montaggio_folder_id text;

comment on column public.poli.drive_immagini_montaggio_folder_id is
  'Id della cartella Drive "Immagini per video" (struttura manuale). Non nullo = '
  'per questo polo ogni immagine caricata in "Immagini montaggio video" viene '
  'copiata su Drive appena caricata, in una sottocartella "Video N — Titolo".';

update public.poli
   set drive_immagini_montaggio_folder_id = '1VZsEwESn2W3A_Lx1XlohZhcTPQw0qHX7'
 where slug = 'genova';
