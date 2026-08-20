-- =====================================================================
-- 0083_accordo_letto_confermato.sql — dichiarazione di lettura dell'accordo
-- =====================================================================
-- Prima di caricare il PDF firmato, il collaboratore deve spuntare "Ho
-- letto e compreso l'accordo editoriale". Il flag è verificato anche
-- server-side (mai fidarsi del solo client) e la stessa dichiarazione
-- viene riportata nel corpo della PEC di conferma — la PEC resta comunque
-- la prova legale, questo campo serve solo a mostrarla nel registro.
-- =====================================================================

alter table public.profiles
  add column if not exists accordo_letto_confermato boolean not null default false;

comment on column public.profiles.accordo_letto_confermato is
  'true se al momento del caricamento il collaboratore ha spuntato "ho letto '
  'e compreso l''accordo editoriale". Verificato anche server-side in '
  'caricaAccordo(); riportato nel testo della PEC di conferma.';
