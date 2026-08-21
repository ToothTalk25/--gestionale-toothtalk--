-- =====================================================================
-- 0088_documento4_nomina_automatica.sql — generazione automatica del
--                                        Modulo di nomina (Documento 4)
-- =====================================================================
-- L'Accordo Editoriale (Art. 6.5, versione finale) prevede che il Modulo
-- di nomina individuale (Documento 4) sia generato automaticamente dal
-- gestionale nel momento in cui il Titolare approva manualmente l'Accordo
-- (accordo_approvato_admin_at, introdotto in 0086). È un atto unilaterale
-- del Titolare: una sola "firma" (l'approvazione stessa), nessuna
-- controfirma del Collaboratore.
--
-- Per compilarlo servono codice fiscale, data e luogo di nascita del
-- Collaboratore.
--
-- ATTENZIONE alla storia di data_nascita/luogo_nascita, perché non è
-- lineare: 0024_profili.sql le aveva introdotte, ma 0026_profili_semplificato
-- le ha RIMOSSE deliberatamente ("dati sensibili che stanno già nel
-- contratto/accordo firmato... nel profilo restano solo nome, cognome e
-- università") come misura di minimizzazione (art. 5(1)(c) GDPR). Questa
-- migrazione le reintroduce, ma non per tornare all'anagrafica generica di
-- 0024: solo perché esiste ora uno scopo nuovo e specifico che 0026 non
-- poteva prevedere — compilare automaticamente il Modulo di nomina — e la
-- premessa di 0026 (questi dati "stanno già nel contratto") non è esatta
-- per l'Accordo Editoriale nella sua forma attuale, che non li richiede.
-- Chi applica questa migrazione deve aggiornare in parallelo
-- src/lib/informativa-privacy.ts (sezioni "Quali dati trattiamo" e
-- "Finalità e base giuridica") per dichiarare questo trattamento — non
-- farlo riproporrebbe lo stesso problema già affrontato con la rimozione
-- del confronto volti (0087): un trattamento reale non dichiarato
-- nell'informativa. codice_fiscale non è mai esistito: lo aggiungiamo qui.
-- =====================================================================

alter table public.profiles
  add column if not exists data_nascita date,
  add column if not exists luogo_nascita text,
  add column if not exists codice_fiscale text,
  add column if not exists nomina_path text,
  add column if not exists nomina_sha256 text,
  add column if not exists nomina_generata_at timestamptz;

comment on column public.profiles.data_nascita is
  'Reintrodotta dopo la rimozione in 0026: serve esclusivamente a compilare '
  'il Modulo di nomina (Documento 4). Vedi nota di testa di questa migrazione.';
comment on column public.profiles.luogo_nascita is
  'Reintrodotta dopo la rimozione in 0026: serve esclusivamente a compilare '
  'il Modulo di nomina (Documento 4). Vedi nota di testa di questa migrazione.';
comment on column public.profiles.codice_fiscale is
  'Codice fiscale del Collaboratore. Richiesto, insieme a data_nascita e '
  'luogo_nascita, prima di poter caricare l''accordo editoriale: serve a '
  'compilare il Modulo di nomina (Documento 4), generato automaticamente '
  'alla approvazione dell''accordo.';
comment on column public.profiles.nomina_path is
  'Percorso nel bucket finali del Modulo di nomina (Documento 4) generato '
  'automaticamente da generaModuloNomina() alla approvazione dell''accordo.';
comment on column public.profiles.nomina_sha256 is
  'Impronta SHA-256 del Modulo di nomina generato.';
comment on column public.profiles.nomina_generata_at is
  'Quando il Modulo di nomina è stato generato (coincide con l''istante di '
  'accordo_approvato_admin_at).';

-- Estende la guardia esistente (0086): i campi nomina_* sono scritti solo
-- dal server al momento della generazione automatica, mai dal Collaboratore
-- né modificabili a mano da un client compromesso.
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
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  return new;
end $$;
