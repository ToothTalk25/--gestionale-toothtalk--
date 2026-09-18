-- =====================================================================
-- 0140_accordo_ricarica.sql — chiedere di ricaricare l'accordo (e farlo sapere)
-- =====================================================================
-- Oggi accorgersi che un accordo è inutilizzabile (incompleto, illeggibile,
-- non firmato) dipende da chi guarda: l'esito del controllo automatico resta
-- scritto nel profilo della persona, che lo legge solo se entra; e dall'altra
-- parte non esiste un modo di chiedere ufficialmente di ricaricarlo — l'unica
-- strada è scriverle fuori dal gestionale, senza che ne resti traccia.
--
-- Qui nasce lo stato della richiesta: due colonne sul profilo, scrivibili SOLO
-- dall'accesso globale (server action chiediRicaricamentoAccordo, che manda
-- anche un'email alla persona e lascia la riga nel registro). Restano finché la
-- persona non carica un accordo nuovo: caricaAccordo le azzera, perché il
-- ricaricamento È la risposta alla richiesta.
--
-- Sull'accordo l'esito automatico non decide mai: la decisione è umana. Queste
-- colonne non bloccano e non sbloccano niente — dicono soltanto che quella
-- persona è stata avvisata, e di che cosa.
-- =====================================================================

alter table public.profiles
  add column if not exists accordo_ricarica_richiesta_at timestamptz,
  add column if not exists accordo_ricarica_motivo       text;

comment on column public.profiles.accordo_ricarica_richiesta_at is
  'Quando l''accesso globale ha chiesto di ricaricare l''accordo (NULL = nessuna richiesta in corso). Si azzera quando arriva un accordo nuovo.';
comment on column public.profiles.accordo_ricarica_motivo is
  'Che cosa è stato chiesto di correggere: lo legge la persona nel proprio profilo, e la riga resta nel registro.';

-- ---------------------------------------------------------------------
-- fn_protect_profile, ridichiarata per intero (come in 0103 e 0118) con i due
-- controlli in più: una richiesta che la persona può cancellare da sé non è una
-- richiesta. Tutti i controlli precedenti restano identici.
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
  if new.accordo_ricarica_richiesta_at is distinct from old.accordo_ricarica_richiesta_at
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La richiesta di ricaricare l''accordo la fa l''accesso globale' using errcode = '42501';
  end if;
  if new.accordo_ricarica_motivo is distinct from old.accordo_ricarica_motivo
     and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La richiesta di ricaricare l''accordo la fa l''accesso globale' using errcode = '42501';
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
