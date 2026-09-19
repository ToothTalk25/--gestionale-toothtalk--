-- =====================================================================
-- 0145_tre_funzioni_di_solo_servizio.sql — correzione della 0144
-- =====================================================================
-- La 0144 ha ridato a chi ha la sessione tutto quello che non stava
-- nell'elenco delle esclusioni. Tre funzioni non erano nell'elenco perché NON
-- erano mai state aperte: erano di solo-servizio fin dalla nascita, e con la
-- regola "tutto tranne" sono rientrate dalla finestra. Sono:
--
--   consuma_invito(codice, utente, email)  — brucia un invito durante la
--       registrazione: la chiama il server (service_role), non il browser;
--   genera_codice_invito(polo)             — genera il codice di un invito:
--       la chiama crea_invito al suo interno;
--   registra_esito_pec(pacchetto, …)       — scrive l'esito di una PEC: lo
--       chiamano la coda PEC e il verbale, sempre con il ruolo del server.
--
-- Le tre si richiudono al solo server. L'elenco delle esclusioni nella 0144 è
-- stato aggiornato nello stesso commit, così un'installazione nuova nasce
-- giusta e questa correzione non serve.
--
-- Il controllo finale è lo stesso della 0144, rifatto qui.
-- =====================================================================

-- Prima le toglie a chi ha la sessione. (La firma esatta è necessaria: la
-- migrazione non deve poter prendere la funzione sbagliata.)
revoke execute on function public.consuma_invito(text, uuid, text) from authenticated;
revoke execute on function public.genera_codice_invito(uuid) from authenticated;
revoke execute on function public.registra_esito_pec(uuid, public.pacchetto_stato, text, text[], text, text) from authenticated;

-- Il server deve poterle eseguire: sono sue.
grant execute on function public.consuma_invito(text, uuid, text) to service_role;
grant execute on function public.genera_codice_invito(uuid) to service_role;
grant execute on function public.registra_esito_pec(uuid, public.pacchetto_stato, text, text[], text, text) to service_role;

do $$
declare
  aperte text;
  quante_anon int;
  quante_sessione int;
begin
  select string_agg(p.proname, ', ' order by p.proname) into aperte
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('consuma_invito', 'genera_codice_invito', 'registra_esito_pec')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if aperte is not null then
    raise exception 'Ancora eseguibili da chi ha la sessione: %', aperte;
  end if;

  select count(*) into quante_anon
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  select count(*) into quante_sessione
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  if quante_anon <> 5 or quante_sessione <> 61 then
    raise exception 'Conteggi inattesi: senza sessione %, con la sessione % (attesi 5 e 61)', quante_anon, quante_sessione;
  end if;

  raise notice 'Diritti: 5 funzioni senza sessione, 61 con la sessione, tutte al server. Le tre di solo-servizio sono chiuse.';
end;
$$;
