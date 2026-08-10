-- =====================================================================
-- 0027_verifica_accordo.sql — esito del controllo IA sull'accordo
-- =====================================================================
-- Quando un partecipante carica l'accordo, un modello IA (Gemini) lo
-- controlla: è l'accordo ToothTalk? c'è una firma nel punto giusto?
-- L'esito è di SEGNALAZIONE, non di blocco: la prova legale resta nella
-- PEC. Qui si conserva il risultato per mostrarlo nel registro.
-- =====================================================================

alter table public.profiles
  add column if not exists accordo_verificato text,
  add column if not exists accordo_verifica_note text,
  add column if not exists accordo_verificato_at timestamptz;

comment on column public.profiles.accordo_verificato is
  'Esito del controllo IA: ok | attenzione | errato | non_valutato.';
comment on column public.profiles.accordo_verifica_note is
  'Motivazione breve del controllo IA (per il controllo manuale).';
