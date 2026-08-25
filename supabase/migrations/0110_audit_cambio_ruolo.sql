-- =====================================================================
-- 0110_audit_cambio_ruolo.sql — ogni cambio di ruolo lascia una traccia
-- =====================================================================
-- Scoperto il 2026-08-25: un account etichettato "Collaboratore Test" è
-- risultato avere role = 'admin', senza NESSUNA riga in audit_log che lo
-- spiegasse. fn_protect_profile blocca già chi non è admin/service_role
-- dal cambiare un ruolo — ma chi HA quei permessi (incluso chi si collega
-- al database direttamente, es. dal pannello Supabase, bypassando
-- completamente l'applicazione) può farlo senza lasciare traccia alcuna:
-- nessuna server action nel codice registra esplicitamente un cambio di
-- ruolo in audit_log.
--
-- Da qui in avanti QUALUNQUE cambio di role su profiles — passi
-- dall'app, da uno script, dal pannello Supabase, non importa — genera
-- comunque una riga in audit_log. Non impedisce una modifica diretta al
-- database (nessun trigger applicativo può farlo: chi ha le chiavi del
-- database ha sempre l'ultima parola), ma garantisce che non resti mai
-- invisibile.
-- =====================================================================

create or replace function public.fn_protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare il ruolo di un utente' using errcode = '42501';
  end if;
  if new.on_screen is distinct from old.on_screen and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare lo status on-screen di un utente' using errcode = '42501';
  end if;
  if new.attivo is distinct from old.attivo and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può attivare/disattivare un account' using errcode = '42501';
  end if;
  if new.approvato_at is distinct from old.approvato_at and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare una registrazione' using errcode = '42501';
  end if;
  if new.approvato_da is distinct from old.approvato_da and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare una registrazione' using errcode = '42501';
  end if;
  if new.accordo_approvato_admin_at is distinct from old.accordo_approvato_admin_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare un accordo' using errcode = '42501';
  end if;
  if new.accordo_approvato_da is distinct from old.accordo_approvato_da
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare un accordo' using errcode = '42501';
  end if;
  if new.nomina_path is distinct from old.nomina_path
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il modulo di nomina è generato automaticamente dal sistema' using errcode = '42501';
  end if;
  if new.nomina_sha256 is distinct from old.nomina_sha256
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il modulo di nomina è generato automaticamente dal sistema' using errcode = '42501';
  end if;
  if new.nomina_generata_at is distinct from old.nomina_generata_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il modulo di nomina è generato automaticamente dal sistema' using errcode = '42501';
  end if;
  if new.accordo_path is distinct from old.accordo_path
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''accordo si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_sha256 is distinct from old.accordo_sha256
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''accordo si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_caricato_at is distinct from old.accordo_caricato_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''accordo si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_letto_confermato is distinct from old.accordo_letto_confermato
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La conferma di lettura avviene dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_verificato is distinct from old.accordo_verificato
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La verifica IA dell''accordo è gestita dal sistema' using errcode = '42501';
  end if;
  if new.accordo_verifica_note is distinct from old.accordo_verifica_note
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La verifica IA dell''accordo è gestita dal sistema' using errcode = '42501';
  end if;
  if new.accordo_verificato_at is distinct from old.accordo_verificato_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La verifica IA dell''accordo è gestita dal sistema' using errcode = '42501';
  end if;
  if new.email is distinct from old.email and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''email si modifica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.codice_fiscale is distinct from old.codice_fiscale
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''anagrafica si modifica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.data_nascita is distinct from old.data_nascita
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''anagrafica si modifica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.luogo_nascita is distinct from old.luogo_nascita
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''anagrafica si modifica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.pec is distinct from old.pec and not (public.is_admin() or public.is_service_role()) then
    raise exception 'L''email/PEC si modifica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;

  -- Da qui il cambio è permesso (siamo sopravvissuti a ogni controllo
  -- sopra): se ha toccato il ruolo, lo registriamo comunque. Chi ha fatto
  -- la modifica agisce con permessi di admin/service_role per definizione
  -- (è l'unico modo di arrivare fin qui con new.role diverso da old.role);
  -- auth.uid() è null quando la modifica arriva da una connessione diretta
  -- (service_role/dashboard, non una sessione applicativa) — lo registriamo
  -- comunque, senza attore identificato invece di far fallire l'inserimento.
  if new.role is distinct from old.role then
    insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, meta)
    values (
      auth.uid(),
      'admin'::public.user_role,
      'cambio_ruolo',
      'profile',
      new.id,
      jsonb_build_object('da', old.role, 'a', new.role, 'email', new.email)
    );
  end if;

  return new;
end $$;
