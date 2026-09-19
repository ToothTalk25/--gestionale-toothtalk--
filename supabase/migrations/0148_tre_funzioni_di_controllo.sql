-- =====================================================================
-- 0148_tre_funzioni_di_controllo.sql — chiudere quello che non serve
-- =====================================================================
-- Tre funzioni restavano eseguibili da chi ha la sessione pur non servendo a
-- nessuno che la sessione ce l'ha. Verificato leggendo i corpi delle funzioni
-- nel database (chi chiama chi):
--
--   consenso_attivo(utente, tipo, versione)  — non la chiama nessuno, né il
--       codice del gestionale né un'altra funzione;
--   consenso_task_valido(progetto)           — la chiama fn_task_consenso_guard,
--       che è una funzione di trigger SECURITY DEFINER: gira con i diritti del
--       proprietario, quindi chi scrive la riga non ha bisogno di poterla
--       eseguire;
--   pacchetto_completo(pacchetto)            — la chiama segnala_completato,
--       anch'essa SECURITY DEFINER, per lo stesso motivo.
--
-- Restano al server (service_role), che le usa senza passare dalle policy.
--
-- NON si tocca, invece, la quarantina di funzioni che il rapportino continua a
-- segnalare a chi ha la sessione, e vale la pena dire perché: è stato provato
-- togliendo il permesso su is_admin() e interrogando il registro da utente
-- collegato — la risposta è `permission denied for function is_admin` e la
-- tabella diventa illeggibile. Le funzioni citate DENTRO una policy devono
-- essere eseguibili da chi interroga: sono la superficie legittima del
-- gestionale (13 dentro le policy, il resto sono le RPC che il browser deve
-- poter chiamare). Toglierle romperebbe il prodotto, non lo renderebbe più
-- sicuro.
-- =====================================================================

revoke execute on function public.consenso_attivo(uuid, text, text) from authenticated;
revoke execute on function public.consenso_task_valido(uuid) from authenticated;
revoke execute on function public.pacchetto_completo(uuid) from authenticated;

grant execute on function public.consenso_attivo(uuid, text, text) to service_role;
grant execute on function public.consenso_task_valido(uuid) to service_role;
grant execute on function public.pacchetto_completo(uuid) to service_role;

do $$
declare
  aperte text;
  senza int;
begin
  select string_agg(p.proname, ', ' order by p.proname) into aperte
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('consenso_attivo', 'consenso_task_valido', 'pacchetto_completo')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if aperte is not null then
    raise exception 'Ancora eseguibili da chi ha la sessione: %', aperte;
  end if;

  -- Le funzioni che stanno dentro le policy devono invece restare: se una sola
  -- di queste risultasse vietata, intere tabelle diventerebbero illeggibili.
  select count(*) into senza
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('is_admin', 'is_member_of', 'accesso_progetti', 'can_read_polo',
                       'polo_of_task', 'polo_of_deliverable', 'is_tecnico', 'shares_polo_with',
                       'task_aperta', 'task_aperta_per_deliverable', 'file_finale_sigillato',
                       'pacchetto_bozza_per_deliverable')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if senza > 0 then
    raise exception 'Funzioni delle policy diventate inaccessibili: % — il gestionale le usa a ogni lettura', senza;
  end if;

  raise notice 'Le tre di controllo sono chiuse; le funzioni delle policy restano (devono).';
end;
$$;
