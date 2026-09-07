-- =====================================================================
-- 0118_controfirma_accordo.sql — controfirma tracciata dell'Accordo
-- =====================================================================
-- L'Accordo Editoriale richiede DUE firme: quella del Collaboratore (già
-- tracciata: accordo_path/sha256/caricato_at) e quella del Titolare, che
-- oggi stampa la copia ricevuta, la firma a mano e ne tiene una copia
-- cartacea controfirmata — passaggio interamente fuori dal gestionale, non
-- tracciato, non richiesto da nessuna condizione di sblocco.
--
-- Questa migrazione introduce:
--   1. accordo_controfirmato_path/sha256/caricato_at — la scansione della
--      copia controfirmata, caricata dal Titolare (sostituisce il click
--      "Approva accordo" con un upload reale).
--   2. accordo_controfirma_confermata_at — il Collaboratore conferma che è
--      lo stesso documento che ha firmato. SOLO a questa conferma si genera
--      il Modulo di Nomina (Documento 4) e si sblocca l'accesso ai progetti
--      (quinta condizione, vedi layout.tsx).
--   3. fn_protect_profile esteso: i 4 nuovi campi sono scrivibili solo da
--      admin/service_role, stesso pattern dei campi accordo_*/rinnovo_*
--      (0103/0111).
--
-- Nessun collaboratore sta usando il gestionale oggi: nessun backfill,
-- nessun caso speciale per chi ha già approvaAccordoManualmente() alle
-- spalle (quella funzione viene sostituita da caricaControfirmaAccordo()).
-- =====================================================================

alter table public.profiles
  add column if not exists accordo_controfirmato_path text,
  add column if not exists accordo_controfirmato_sha256 text,
  add column if not exists accordo_controfirmato_caricato_at timestamptz,
  add column if not exists accordo_controfirma_confermata_at timestamptz;

comment on column public.profiles.accordo_controfirmato_path is
  'Scansione della copia cartacea dell''Accordo controfirmata a mano dal '
  'Titolare, caricata da caricaControfirmaAccordo(). Sostituisce il vecchio '
  'click "Approva accordo": ora è un upload tracciato, non un''azione senza '
  'documento.';
comment on column public.profiles.accordo_controfirmato_sha256 is
  'Impronta SHA-256 della scansione controfirmata, ricalcolata lato server '
  'al caricamento (mai quella dichiarata dal client).';
comment on column public.profiles.accordo_controfirmato_caricato_at is
  'Quando il Titolare ha caricato la scansione controfirmata.';
comment on column public.profiles.accordo_controfirma_confermata_at is
  'Quando il Collaboratore ha confermato che la scansione controfirmata è '
  'lo stesso documento che ha firmato. SOLO da questo momento si genera il '
  'Modulo di Nomina (Documento 4) e si sblocca l''accesso ai progetti '
  '(quinta condizione in layout.tsx). Dopo questa conferma, codice_fiscale, '
  'data_nascita e luogo_nascita si bloccano (aggiornaAnagrafica) e non si '
  'può ricaricare un nuovo accordo (caricaAccordo) senza intervento admin.';

-- ---------------------------------------------------------------------
-- Guardia dei nuovi campi: scrivibili solo da admin/service_role, come
-- tutti gli altri campi sensibili. caricaControfirmaAccordo e
-- confermaControfirmaAccordo passano dal service_role. Mai dal client.
-- ---------------------------------------------------------------------
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

  -- Campi accordo: scritti solo da caricaAccordo / caricaControfirmaAccordo
  -- (server action, che ora passano dal service_role). Mai dal client.
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
  -- Controfirma del Titolare e conferma del Collaboratore: stesso principio
  -- dei campi accordo_* sopra, solo per l'altra metà della firma.
  if new.accordo_controfirmato_path is distinct from old.accordo_controfirmato_path
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La controfirma si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_controfirmato_sha256 is distinct from old.accordo_controfirmato_sha256
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La controfirma si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_controfirmato_caricato_at is distinct from old.accordo_controfirmato_caricato_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La controfirma si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.accordo_controfirma_confermata_at is distinct from old.accordo_controfirma_confermata_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La conferma della controfirma avviene dal flusso dedicato' using errcode = '42501';
  end if;
  -- Scadenza e rinnovo: scritti solo da caricaControfirmaAccordo (tramite
  -- il trigger di scadenza), caricaRinnovoAccordo e approvaRinnovoAccordo.
  if new.accordo_scadenza is distinct from old.accordo_scadenza
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La scadenza dell''accordo è calcolata dal sistema' using errcode = '42501';
  end if;
  if new.rinnovo_path is distinct from old.rinnovo_path
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il rinnovo si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.rinnovo_sha256 is distinct from old.rinnovo_sha256
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il rinnovo si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.rinnovo_caricato_at is distinct from old.rinnovo_caricato_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Il rinnovo si carica dal flusso dedicato' using errcode = '42501';
  end if;
  if new.rinnovo_approvato_admin_at is distinct from old.rinnovo_approvato_admin_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare un rinnovo' using errcode = '42501';
  end if;
  if new.rinnovo_approvato_da is distinct from old.rinnovo_approvato_da
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può approvare un rinnovo' using errcode = '42501';
  end if;
  -- Anagrafica sensibile: aggiornata solo dalla server action aggiornaAnagrafica.
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
