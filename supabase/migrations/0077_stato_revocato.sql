-- =====================================================================
-- 0077_stato_revocato.sql — stato task "archived_due_to_revocation"
-- =====================================================================
-- Nuovo stato per le task il cui Front Man ha revocato il consenso
-- (Art. 17 GDPR): il video è stato purgato dallo storage, il progetto è
-- archiviato come "terminato per revoca" ma i materiali di backstage
-- (script, copertine, descrizioni) restano integri nel registro.
--
-- Non serve toccare fn_tasks_guard: la whitelist degli stati permessi ai
-- non-admin è già chiusa ('da_fare','consegnato','in_revisione'), quindi
-- questo nuovo valore è automaticamente riservato al Titolare.
-- =====================================================================

alter type public.task_status add value if not exists
  'archived_due_to_revocation' before 'pubblicato';
