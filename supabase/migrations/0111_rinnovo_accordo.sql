-- =====================================================================
-- 0111_rinnovo_accordo.sql — scadenza a 6 mesi dell'Accordo e rinnovo
-- =====================================================================
-- L'Accordo (Art. 9.1) ha durata fissa di 6 mesi dalla sottoscrizione,
-- rinnovabile con un documento di rinnovo approvato dal Coordinatore.
-- Oggi il gestionale NON ha alcuna scadenza: accordo_approvato_admin_at
-- (0086) è un timestamp scritto una volta e mai più ricontrollato.
--
-- Questa migrazione introduce:
--   1. accordo_scadenza date — il giorno in cui il periodo di 6 mesi finisce.
--      Lo scrive il sistema (approvazione iniziale o rinnovo), MAI a mano.
--   2. campi rinnovo_* — il documento di rinnovo corrente (in attesa di
--      approvazione). All'approvazione i campi file si consolidano nella
--      nuova accordo_scadenza e si azzerano (rinnovo_path torna null),
--      pronti al ciclo successivo: la copia su Drive fa già da archivio,
--      non serve una tabella storica.
--   3. trigger fn_accordo_scadenza — ogni approvazione di accordo SENZA
--      scadenza esplicita apre automaticamente un periodo di 6 mesi. Così
--      l'approvazione iniziale (approvaAccordoManualmente, che NON viene
--      toccata) e l'approvazione dei rinnovi restano coerenti anche per le
--      scritture dirette al database.
--   4. fn_protect_profile esteso: i nuovi campi sono scrivibili solo da
--      admin/service_role, stesso pattern dei campi accordo_* (0103/0110).
-- =====================================================================

alter table public.profiles
  add column if not exists accordo_scadenza date,
  add column if not exists rinnovo_path text,
  add column if not exists rinnovo_sha256 text,
  add column if not exists rinnovo_caricato_at timestamptz,
  add column if not exists rinnovo_approvato_admin_at timestamptz,
  add column if not exists rinnovo_approvato_da uuid references public.profiles(id);

comment on column public.profiles.accordo_scadenza is
  'Ultimo giorno del periodo di 6 mesi dell''accordo (dalla approvazione '
  'iniziale o dall''ultimo rinnovo). Quando è passata, il gestionale sospende '
  'l''accesso ai progetti (Art. 9.1) finché un documento di rinnovo non è '
  'approvato dal Coordinatore. La calcola il sistema, mai un utente.';
comment on column public.profiles.rinnovo_path is
  'Documento di rinnovo corrente (in attesa di approvazione del Coordinatore). '
  'All''approvazione si consolida nella nuova accordo_scadenza e torna null, '
  'pronto per il ciclo successivo.';
comment on column public.profiles.rinnovo_sha256 is
  'Impronta SHA-256 del documento di rinnovo, ricalcolata lato server al '
  'caricamento (mai quella dichiarata dal client).';
comment on column public.profiles.rinnovo_caricato_at is
  'Quando il Collaboratore ha caricato il documento di rinnovo corrente.';
comment on column public.profiles.rinnovo_approvato_admin_at is
  'Quando il Coordinatore ha approvato l''ULTIMO rinnovo. null finché non ce '
  'n''è stato uno.';
comment on column public.profiles.rinnovo_approvato_da is
  'Coordinatore che ha approvato l''ultimo rinnovo.';

-- ---------------------------------------------------------------------
-- Trigger di scadenza automatica: ogni approvazione senza scadenza
-- esplicita apre un periodo di 6 mesi (iniziale o rinnovo). Se il rinnovo
-- imposta accordo_scadenza esplicitamente, il trigger non lo tocca.
-- ---------------------------------------------------------------------
create or replace function public.fn_accordo_scadenza()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.accordo_approvato_admin_at is not null and new.accordo_scadenza is null then
    new.accordo_scadenza := (new.accordo_approvato_admin_at + interval '6 months')::date;
  end if;
  return new;
end $$;

drop trigger if exists trg_accordo_scadenza on public.profiles;
create trigger trg_accordo_scadenza
  before insert or update on public.profiles
  for each row execute function public.fn_accordo_scadenza();

-- Backfill retroattivo: chi ha GIÀ l'accordo approvato parte con i suoi 6
-- mesi contati dalla data di approvazione (per i preesistenti quella data è
-- l'istante in cui è stata applicata 0086). Vale solo dove manca la scadenza.
update public.profiles
  set accordo_scadenza = (accordo_approvato_admin_at + interval '6 months')::date
  where accordo_approvato_admin_at is not null
    and accordo_scadenza is null;

-- ---------------------------------------------------------------------
-- Guardia dei nuovi campi: accordo_scadenza e rinnovo_* sono scrivibili
-- solo da admin/service_role, come tutti gli altri campi sensibili. Le
-- server action legittime (caricaRinnovoAccordo, approvaRinnovoAccordo)
-- passano dal service_role. Mai dal client.
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

  -- Campi accordo: scritti solo da caricaAccordo / approvaAccordoManualmente
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
  -- Scadenza e rinnovo: scritti solo da approvaAccordoManualmente (tramite
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

