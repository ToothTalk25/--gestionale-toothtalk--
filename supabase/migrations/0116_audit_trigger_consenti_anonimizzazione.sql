-- =====================================================================
-- 0116_audit_trigger_consenti_anonimizzazione.sql — l'eliminazione di un
--                                           account anonimizza l'attore
-- =====================================================================
-- 0115 ha messo audit_log.actor su ON DELETE SET NULL: quando un account
-- sparisce, la riga di audit DEVE restare intatta ma con actor null. Il
-- trigger append-only (fn_audit_append_only) rifiuta però QUALSIASI UPDATE,
-- incluso quello di mantenimento che Postgres esegue in automatico per la
-- FK — di fatto rendendo impossibile eliminare un account con righe di
-- audit.
--
-- Questa migrazione restringe l'append-only al suo scopo vero: nessuna
-- cancellazione, nessuna modifica al CONTENUTO della riga. L'unico UPDATE
-- permesso è l'anonimizzazione dell'attore (actor → null) quando la FK lo
-- esegue per conto della cancellazione. Nessun ruolo non fidato può
-- comunque aggiornare audit_log (non esiste alcuna policy di UPDATE per
-- authenticated): chi arriva al trigger lo fa solo con permessi da
-- service_role/owner. La riga resta immutabile in ogni suo campo.
-- =====================================================================

create or replace function public.fn_audit_append_only()
returns trigger language plpgsql as $$
declare
  contenuto_identico boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log è append-only' using errcode = '42501';
  end if;

  -- UPDATE permesso SOLO per l'anonimizzazione dell'attore via FK
  -- (0115/0116: on delete set null quando un account sparisce). Contenuto
  -- della riga identico, solo actor diventa null. Ogni altro UPDATE è
  -- rifiutato — il registro resta immutabile.
  contenuto_identico :=
    new.at = old.at
    and new.actor_role is not distinct from old.actor_role
    and new.action = old.action
    and new.entity_type = old.entity_type
    and new.entity_id is not distinct from old.entity_id
    and new.polo_id is not distinct from old.polo_id
    and new.meta is not distinct from old.meta;

  if not (contenuto_identico and old.actor is not null and new.actor is null) then
    raise exception 'audit_log è append-only' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists trg_audit_append_only on public.audit_log;
create trigger trg_audit_append_only
  before update or delete on public.audit_log
  for each row execute function public.fn_audit_append_only();
