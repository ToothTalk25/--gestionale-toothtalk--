-- =====================================================================
-- 0144_diritti_delle_funzioni.sql — chi può chiamare cosa
-- =====================================================================
-- Perché. In PostgreSQL ogni funzione nasce eseguibile da PUBLIC — cioè da
-- chiunque, anche da chi non ha fatto l'accesso. Su un progetto Supabase questo
-- significa che con la sola chiave pubblica (quella che sta nel browser di
-- tutti) si possono chiamare 79 funzioni su 82: `annulla_pacchetto`,
-- `elimina_progetto`, `revoca_consenso`, i guardiani dei trigger, la funzione
-- di manutenzione notturna. È la segnalazione più numerosa del controllo di
-- Supabase (112 voci).
--
-- Non tutte sono pericolose — le funzioni che lavorano "come il chiamante"
-- (SECURITY INVOKER) non possono fare niente che il chiamante non possa già
-- fare — ma non c'è motivo di lasciarle aperte, e per quelle SECURITY DEFINER
-- il rischio è reale: girano con i diritti del proprietario.
--
-- Cosa fa questa migrazione, in tre mosse:
--   1. chiude il rubinetto per il futuro: le funzioni NUOVE in `public` non
--      nasceranno più eseguibili da tutti (alter default privileges);
--   2. toglie a `anon` e a chi ha la sessione tutto ciò che non serve loro,
--      e lo ridà solo dove serve e a chi serve;
--   3. verifica da sé che il risultato sia quello scritto qui sopra, e
--      altrimenti fa fallire la migrazione.
--
-- A `service_role` (il ruolo del server, che non passa nemmeno dalle policy)
-- resta tutto: è quello che usa il gestionale per le operazioni di servizio.
--
-- Perché è sicuro farlo: un trigger NON ha bisogno che il ruolo che scrive la
-- riga possa eseguire la sua funzione (i trigger si eseguono con i diritti del
-- proprietario della tabella), e nessuna delle funzioni di trigger qui sotto
-- viene chiamata da un'altra funzione — verificato prima di scrivere la
-- migrazione, funzione per funzione. Le funzioni che invece lavorano come il
-- chiamante (fn_*_guard, is_service_role, storage_*) restano accessibili:
-- servono proprio a chi scrive, e non possono allargare i suoi diritti.
-- =====================================================================

-- ------------------------------------------------ 1. per le funzioni future
alter default privileges in schema public revoke execute on functions from public;

-- ------------------------------------------------ 2. il presente
-- Via tutto a tutti (tranne service_role), poi si ridà con giudizio.
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on all functions in schema public to service_role;

-- Chi non ha la sessione: SOLO i quattro percorsi pubblici, cioè le pagine che
-- si aprono da un link ricevuto per email o dalla registrazione — chi le usa
-- non ha (e non deve avere) un accesso.
grant execute on function public.verifica_invito(text) to anon;
grant execute on function public.verifica_token_liberatoria(text) to anon;
grant execute on function public.registra_upload_liberatoria(text, uuid) to anon;
grant execute on function public.registra_upload_liberatoria(text, uuid, text) to anon;
grant execute on function public.verifica_token_onboarding(text) to anon;

-- Chi ha la sessione: tutto il resto, TRANNE queste. Le sedici `fn_*` e
-- `handle_new_user` sono funzioni di trigger (nessun utente le chiama: le
-- chiama il database) e le due in fondo sono manutenzione, che il server
-- esegue con il proprio ruolo.
do $$
declare
  fuori text[] := array[
    'fn_audit_chain',
    'fn_avvisa_esportazione_drive',
    'fn_avvisa_immagine_montaggio',
    'fn_crea_task_presentazione_iniziale',
    'fn_domanda_tecnico_solo_risposta',
    'fn_elementi_congelati',
    'fn_elemento_coerente',
    'fn_log_eliminazione_versione',
    'fn_pacchetto_guard',
    'fn_protect_profile',
    'fn_seal_version',
    'fn_task_consenso_guard',
    'fn_tasks_guard',
    'fn_tasks_status_history',
    'fn_version_side_effects',
    'handle_new_user',
    'controlla_integrita',
    'audit_verifica_catena',
    -- Queste tre erano già di solo-servizio prima della 0144: senza elencarle,
    -- la regola "tutto tranne" le avrebbe riaperte a chi ha la sessione.
    -- (Successo davvero: la correzione sta nella 0145.)
    'consuma_invito',
    'genera_codice_invito',
    'registra_esito_pec'
  ];
  r record;
  assegnate int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
  loop
    if not (r.proname = any (fuori)) then
      execute format('grant execute on function %s to authenticated', r.oid::regprocedure);
      assegnate := assegnate + 1;
    end if;
  end loop;
  raise notice 'Funzioni eseguibili da chi ha la sessione: %', assegnate;
end;
$$;

-- ------------------------------------------------ 3. il controllo
-- La migrazione verifica da sé di aver fatto quello che dice. Se qualcosa non
-- torna, si ferma qui e non lascia il database in uno stato intermedio.
do $$
declare
  fuori text[] := array[
    'fn_audit_chain', 'fn_avvisa_esportazione_drive', 'fn_avvisa_immagine_montaggio',
    'fn_crea_task_presentazione_iniziale', 'fn_domanda_tecnico_solo_risposta',
    'fn_elementi_congelati', 'fn_elemento_coerente', 'fn_log_eliminazione_versione',
    'fn_pacchetto_guard', 'fn_protect_profile', 'fn_seal_version',
    'fn_task_consenso_guard', 'fn_tasks_guard', 'fn_tasks_status_history',
    'fn_version_side_effects', 'handle_new_user', 'controlla_integrita',
    'audit_verifica_catena'
  ];
  aperte text;
  senza_sessione text;
  quante_anon int;
begin
  -- (a) le funzioni dell'elenco non devono essere eseguibili da chi ha la sessione
  select string_agg(p.proname, ', ' order by p.proname) into aperte
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any (fuori)
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if aperte is not null then
    raise exception 'Ancora eseguibili da chi ha la sessione: %', aperte;
  end if;

  -- (b) chi non ha la sessione deve poter eseguire SOLO i quattro percorsi pubblici
  select count(*) into quante_anon
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if quante_anon <> 5 then
    select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
      into senza_sessione
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE');
    raise exception 'Senza sessione si possono eseguire % funzioni (attese 5): %', quante_anon, senza_sessione;
  end if;

  raise notice 'Diritti verificati: 5 funzioni senza sessione, il resto solo a chi ha la sessione o al server.';
end;
$$;
