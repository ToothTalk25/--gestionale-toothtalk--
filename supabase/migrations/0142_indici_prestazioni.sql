-- =====================================================================
-- 0142_indici_prestazioni.sql — gli indici che mancavano
-- =====================================================================
-- Due gruppi, per due motivi diversi. Il primo si sente subito, il secondo è
-- protezione per quando l'archivio crescerà (adesso il database è 15 MB e
-- queste tabelle hanno decine di righe: nessun indice "serve" ancora, ma
-- aggiungerli costa nulla e evita che il primo problema serio arrivi da lì).
--
-- GRUPPO 1 — si sente oggi
--   audit_log (at desc): il Registro legge le ultime 80 operazioni in ordine
--   di data. Senza indice il database ordina TUTTA la tabella a ogni apertura
--   (misurato: 20,79 ms di media su 272 righe, con la policy a valutazione
--   per riga corretta in 0141). Con l'indice si ferma alle 80 che mostra.
--
--   memberships (polo_id, user_id): le policy dello storage e le pagine "chi
--   c'è in questo polo" cercano per polo. La chiave primaria è (user_id,
--   polo_id), quindi per il verso (user_id → poli) va bene, per l'altro no.
--
-- GRUPPO 2 — chiavi esterne senza indice (segnalate dal controllo
-- `npm run audit-rls`). Servono a due cose: le ricerche "per chi" nelle
-- pagine e i controlli che PostgreSQL fa quando si cancella o si aggiorna una
-- riga collegata (senza indice, quel controllo legge tutta la tabella). Sono
-- scritte una per una, e non con un ciclo, così si vede esattamente cosa
-- nasce: se un giorno una non serve, si toglie senza indovinare.
--
-- Nota: nessun indice cambia il comportamento delle policy o dei permessi.
-- =====================================================================

-- ---------------------------------------------------- GRUPPO 1: si sente oggi

create index if not exists audit_log_at_idx on public.audit_log (at desc);
comment on index public.audit_log_at_idx is
  'Il Registro legge le ultime operazioni in ordine di data: senza indice ordinava tutta la tabella.';

create index if not exists memberships_polo_user_idx on public.memberships (polo_id, user_id);
comment on index public.memberships_polo_user_idx is
  'Ricerca per polo: la chiave primaria e'' (user_id, polo_id) e non serve al verso opposto.';

-- ------------------------------------------- GRUPPO 2: chiavi esterne senza indice

create index if not exists audit_log_actor_idx on public.audit_log (actor);
create index if not exists collaboratori_tecnici_created_by_idx on public.collaboratori_tecnici (created_by);
create index if not exists collaboratori_tecnici_rinnovo_da_idx on public.collaboratori_tecnici (rinnovo_approvato_da);
create index if not exists collaboratori_tecnici_accessi_created_by_idx on public.collaboratori_tecnici_accessi (created_by);
create index if not exists consensi_revocato_da_idx on public.consensi (revocato_da);
create index if not exists consents_and_releases_revocato_da_idx on public.consents_and_releases (revocato_da);
create index if not exists consents_and_releases_richiesta_id_idx on public.consents_and_releases (richiesta_id);
create index if not exists deliverable_versions_uploaded_by_idx on public.deliverable_versions (uploaded_by);
create index if not exists deliverables_created_by_idx on public.deliverables (created_by);
create index if not exists documenti_magazzino_caricato_da_idx on public.documenti_magazzino (caricato_da);
create index if not exists domande_supporto_risposto_da_idx on public.domande_supporto (risposto_da);
create index if not exists domande_supporto_user_id_idx on public.domande_supporto (user_id);
create index if not exists inviti_creato_da_idx on public.inviti (creato_da);
create index if not exists inviti_onboarding_creato_da_idx on public.inviti_onboarding (creato_da);
create index if not exists inviti_utilizzi_user_id_idx on public.inviti_utilizzi (user_id);
create index if not exists modello_accordo_caricato_da_idx on public.modello_accordo (caricato_da);
create index if not exists notifiche_art82_notificata_da_idx on public.notifiche_dovute_art82 (notificata_da);
create index if not exists pacchetti_video_created_by_idx on public.pacchetti_video (created_by);
create index if not exists pacchetti_video_sigillato_da_idx on public.pacchetti_video (sigillato_da);
create index if not exists pacchetto_elementi_version_id_idx on public.pacchetto_elementi (version_id);
create index if not exists profiles_accordo_approvato_da_idx on public.profiles (accordo_approvato_da);
create index if not exists profiles_approvato_da_idx on public.profiles (approvato_da);
create index if not exists profiles_rinnovo_approvato_da_idx on public.profiles (rinnovo_approvato_da);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index if not exists richieste_eliminazione_grezzo_risolta_da_idx on public.richieste_eliminazione_grezzo (risolta_da);
create index if not exists richieste_liberatoria_task_id_idx on public.richieste_liberatoria (task_id);
create index if not exists richieste_liberatoria_version_id_idx on public.richieste_liberatoria (version_id);
create index if not exists richieste_modifica_completata_da_idx on public.richieste_modifica (completata_da);
create index if not exists richieste_modifica_creata_da_idx on public.richieste_modifica (creata_da);
create index if not exists richieste_modifica_pacchetto_id_idx on public.richieste_modifica (pacchetto_id);
create index if not exists richieste_modifica_risolta_da_idx on public.richieste_modifica (risolta_da);
create index if not exists richieste_ricar_dich_pacchetto_id_idx on public.richieste_ricaricamento_dichiarazione (pacchetto_id);
create index if not exists richieste_ricar_dich_risolta_da_idx on public.richieste_ricaricamento_dichiarazione (risolta_da);
create index if not exists richieste_rimozione_risolta_da_idx on public.richieste_rimozione_pubblicato (risolta_da);
create index if not exists task_status_history_actor_idx on public.task_status_history (actor);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_formato_id_idx on public.tasks (formato_id);
create index if not exists verifiche_riconoscimento_corretto_da_idx on public.verifiche_riconoscimento (corretto_da);

-- Controllo: non deve restare nessuna chiave esterna senza un indice che
-- cominci dalla sua colonna (le stesse che `npm run audit-rls` elenca).
do $$
declare
  mancanti text;
begin
  select string_agg(x.tabella || '.' || x.colonna, ', ' order by x.tabella, x.colonna)
    into mancanti
    from (
      select c.conrelid::regclass::text as tabella, a.attname as colonna
        from pg_constraint c
        join unnest(c.conkey) as k(attnum) on true
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.conrelid and i.indkey[0] = k.attnum
         )
    ) x;

  if mancanti is not null then
    raise exception 'Chiavi esterne ancora senza indice in prima posizione: %', mancanti;
  end if;
  raise notice 'Tutte le chiavi esterne hanno un indice che comincia dalla loro colonna.';
end;
$$;
