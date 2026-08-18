-- =====================================================================
-- 0075_richieste_liberatoria_no_delete.sql
-- =====================================================================
-- richieste_liberatoria aveva una policy "richieste_admin" con cmd=ALL:
-- un admin poteva cancellare una richiesta di liberatoria, comprese
-- quelle già firmate via OTP — in contrasto con l'append-only delle
-- altre tabelle prova (audit_log, consents_and_releases,
-- deliverable_versions per i file finali già sigillati). Se una prova di
-- consenso di terzi viene cancellata, si perde la prova stessa.
--
-- Verificato: nessun .delete() su richieste_liberatoria in tutto il
-- codice applicativo (grep su src/ e supabase/functions/) — la
-- restrizione non rompe nessun flusso esistente. Il client service_role
-- (usato per operazioni interne come lo scadenziario) bypassa comunque
-- le RLS, quindi non è impattato da questa policy.
-- =====================================================================

drop policy if exists richieste_admin on public.richieste_liberatoria;

create policy richieste_admin_select on public.richieste_liberatoria
  for select using (public.is_admin());

create policy richieste_admin_insert on public.richieste_liberatoria
  for insert with check (public.is_admin());

create policy richieste_admin_update on public.richieste_liberatoria
  for update using (public.is_admin()) with check (public.is_admin());

revoke delete on public.richieste_liberatoria from anon, authenticated;
