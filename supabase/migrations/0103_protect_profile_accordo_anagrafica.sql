-- =====================================================================
-- 0103_protect_profile_accordo_anagrafica.sql — chiudere i campi sensibili
-- =====================================================================
-- Un utente autenticato poteva scrivere direttamente dal client Supabase
-- (via profiles_update_self, aggirando la UI) i propri campi accordo e
-- anagrafica: accordo_path/letto/verificato/note, email, codice_fiscale,
-- data_nascita, luogo_nascita, pec. Così poteva FABBRICARE uno stato
-- "accordo verificato dall'IA" senza passare da caricaAccordo.
--
-- Questa migrazione estende fn_protect_profile (stesso pattern di role/
-- on_screen/attivo/approvato/nomina): le colonne sotto sono scrivibili solo
-- da admin o service_role. Le server action legittime (caricaAccordo,
-- aggiornaAnagrafica, caricaFoto) vengono portate a supabaseAdmin() in
-- parallelo (vedi actions-profilo.ts).
--
-- FOTO_PATH resta volutamente FUORI dalla whitelist protetta: è la foto
-- profilo che l'utente carica da sé via caricaFoto().
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
  return new;
end $$;

