-- =====================================================================
-- 0101_rimozione_aperta_unique.sql — una sola richiesta aperta per utente
-- =====================================================================
-- Difesa a livello DB contro le pratiche parallele: un Collaboratore non può
-- avere più di una richiesta di rimozione pubblicato APERTA alla volta.
-- L'app già evita il doppio insert (vedi revocaImmagineVoce), questo vincolo
-- blocca anche le chiamate dirette.
-- =====================================================================

create unique index if not exists idx_rimozione_aperta_user
  on public.richieste_rimozione_pubblicato (user_id)
  where stato = 'aperta';
