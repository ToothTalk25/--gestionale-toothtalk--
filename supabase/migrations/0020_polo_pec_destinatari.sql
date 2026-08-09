-- =====================================================================
-- 0020_polo_pec_destinatari.sql — destinatari PEC per singolo gruppo
-- =====================================================================
-- Ogni gruppo universitario può avere una lista di destinatari PEC
-- diversa: il verbale di un deposito di Messina arriva a Messina, quello
-- di Genova a Genova. La colonna lo permette; se vuota, si usa il fallback
-- globale PEC_DESTINATARI (in .env.local).
-- =====================================================================

alter table public.poli
  add column if not exists pec_destinatari text[];

comment on column public.poli.pec_destinatari is
  'Destinatari PEC di questo gruppo (in sostituzione del globale PEC_DESTINATARI, se compilata).';
