-- ============================================================================
-- 0133 — Nuovo ruolo applicativo: "tecnico" (Collaboratore Tecnico)
--
-- Cambio di decisione del 16/09/2026 (sostituisce l'Opzione B, solo PEC/email,
-- scritta nel Documento 5): il Collaboratore Tecnico ha ora un proprio accesso
-- al gestionale, per leggere e rispondere DIRETTAMENTE alle domande tecniche
-- dei partecipanti, senza passare dall'accesso globale.
--
-- ATTENZIONE: questo file si esegue DA SOLO, con
--   npm run migra -- 0133
-- perché aggiunge un valore a un tipo enum: PostgreSQL non permette di USARE
-- un valore appena aggiunto nella stessa transazione in cui è stato aggiunto.
-- Le policy e le funzioni che usano 'tecnico' stanno nel file 0134.
-- ============================================================================

alter type public.user_role add value if not exists 'tecnico';
