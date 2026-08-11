-- =====================================================================
-- 0046_consensi_ricevuta.sql — ricevuta firmata per ogni consenso GDPR
-- =====================================================================
-- Per ogni accettazione della privacy o cookie policy viene generato un
-- documento HTML firmato (SHA256) e conservato in storage, così da
-- dimostrare il consenso in caso di audit.
-- =====================================================================

alter table public.consensi
  add column if not exists storage_path text,
  add column if not exists sha256 text;
