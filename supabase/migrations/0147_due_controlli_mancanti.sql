-- =====================================================================
-- 0147_due_controlli_mancanti.sql — due policy lasciavano spostare le righe
-- =====================================================================
-- Perché. In una policy per UPDATE, `USING` decide QUALI righe si possono
-- modificare e `WITH CHECK` cosa può diventare una riga DOPO la modifica. Se il
-- secondo manca — o peggio è scritto `true`, come in queste due — si può
-- cambiare la riga in qualcosa che non si sarebbe mai potuto creare.
--
-- Le due:
--
--   pacchetto_elementi.elementi_update — un partecipante può aggiornare gli
--     elementi di un pacchetto in bozza del proprio polo. Con il controllo
--     sempre vero poteva anche SPOSTARE quell'elemento in un pacchetto di un
--     altro polo, o dentro un pacchetto già sigillato: la riga si spostava
--     dalla parte sbagliata dello schermo, senza che nessuno la vedesse.
--
--   richieste_modifica.richieste_update — chi è nel polo (o l'accesso globale)
--     può aggiornare una richiesta di modifica. Con il controllo sempre vero
--     poteva spostarla su un progetto di un altro polo.
--
-- Il rimedio è quello che il database stesso suggerisce: lo stesso controllo
-- del `USING`, applicato ai valori nuovi. Non cambia niente per chi lavora
-- dentro il proprio polo; chiude solo lo spostamento.
--
-- Nota su `is_admin()`: si scrive `(select is_admin())` — valutato una volta
-- per interrogazione — perché è la forma corretta dalla 0141.
-- =====================================================================

alter policy elementi_update on public.pacchetto_elementi
  with check (
    exists (
      select 1
        from public.pacchetti_video p
       where p.id = pacchetto_elementi.pacchetto_id
         and public.is_member_of(public.polo_of_task(p.task_id))
         and p.stato = 'bozza'::public.pacchetto_stato
    )
  );

alter policy richieste_update on public.richieste_modifica
  with check (
    (select public.is_admin())
    or public.is_member_of(public.polo_of_task(task_id))
  );

-- Controllo: negli schemi esposti non deve restare nessuna policy di
-- inserimento, modifica o cancellazione con il controllo scritto `true`.
-- (Se il controllo fosse assente del tutto, PostgreSQL userebbe il `USING`:
-- innocuo. Il problema è proprio il `true` esplicito.)
do $$
declare
  aperte text;
begin
  select string_agg(x.tabella || '.' || x.policy, ', ' order by 1) into aperte
    from (
      select c.relname as tabella, p.polname as policy
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and p.polcmd in ('a', 'w', 'd')
         and pg_get_expr(p.polwithcheck, p.polrelid) in ('true', '(true)')
    ) x;

  if aperte is not null then
    raise exception 'Policy con il controllo sempre vero: %', aperte;
  end if;
  raise notice 'Nessuna policy di scrittura con il controllo sempre vero.';
end;
$$;
