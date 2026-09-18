-- =====================================================================
-- 0137 — il varco dell'Accordo vale anche nel database, non solo nell'app
-- =====================================================================
-- Perché serve. Il blocco dell'accesso ai progetti finché l'Accordo non è
-- completo vive nel proxy (src/proxy.ts) e nel layout: è una regola
-- APPLICATIVA. Chi ha una sessione valida ma l'Accordo incompleto poteva
-- chiamare direttamente l'API (PostgREST con la chiave anon, che il browser
-- ha) e leggere i progetti del proprio gruppo: era l'ultimo varco
-- aggirabile rimasto. Qui la stessa regola scende nel database.
--
-- Come. La funzione accesso_progetti() rispecchia accordoCompleto() di
-- src/lib/accordo.ts, condizione per condizione (leggi le due insieme: se
-- una cambia, l'altra va cambiata nello stesso momento). Le policy sono
-- tutte "as restrictive": si SOMMANO a quelle permissive esistenti invece
-- di riscriverle. In Postgres l'accesso passa solo se almeno una policy
-- permissiva è vera E tutte le restrictive lo sono: le policy di oggi
-- restano quindi quelle che decidono CHI (il gruppo), questa decide solo SE
-- l'Accordo è in regola. Nessuna definizione da tenere allineata a mano.
--
-- Cosa NON entra nel varco: profilo, consensi, inviti, domande di supporto,
-- push, richieste dell'uscita e il bucket "profili" (dove si carica proprio
-- l'Accordo). Sono le cose che servono per COMPLETARLO: bloccare anche
-- quelle impedirebbe a chi non ha l'Accordo di farselo approvare. Del
-- magazzino del gruppo si blinda invece la lettura, perché è materiale
-- dell'area progetti.
--
-- L'accesso globale (role = 'admin') e il Collaboratore Tecnico (role =
-- 'tecnico', che un Accordo non ce l'ha per definizione) non sono soggetti
-- al varco, esattamente come nell'app.
-- =====================================================================

-- ---------------------------------------------------- la regola, in un posto
create or replace function public.accesso_progetti(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and exists (
    select 1
      from public.profiles p
     where p.id = p_uid
       and p.attivo
       and (
         -- Accesso globale e Collaboratore Tecnico: nessun Accordo da
         -- completare, quindi nessun varco. (Non allarga niente: le policy
         -- permissive di oggi continuano a decidere cosa vedono.)
         p.role <> 'member'
         or (
           -- 1. accordo caricato
           p.accordo_path is not null
           -- 2. "ho letto e compreso" confermato prima del caricamento
           and p.accordo_letto_confermato
           -- 3. verifica superata
           and p.accordo_verificato = 'ok'
           -- 4. approvazione dell'accesso globale
           and p.accordo_approvato_admin_at is not null
           -- 5. controfirma caricata E confermata dal Collaboratore, oppure
           --    mai richiesta: chi era già approvato prima che la controfirma
           --    esistesse (0118, 7 settembre 2026) non deve inventare una
           --    conferma che nessuno gli ha chiesto. Stessa soglia di
           --    CONTROFIRMA_OBBLIGATORIA_DAL in src/lib/accordo.ts.
           and (
             p.accordo_controfirma_confermata_at is not null
             or (
               p.accordo_controfirmato_path is null
               and p.accordo_approvato_admin_at < timestamptz '2026-09-07 19:16:49+02:00'
             )
           )
           -- 6. accordo non scaduto (Art. 9.1): il giorno di scadenza
           --    appartiene ancora al periodo, la sospensione parte il giorno
           --    dopo — stessa regola di accordoScaduto().
           and (p.accordo_scadenza is null or p.accordo_scadenza >= current_date)
         )
       )
  );
$$;

comment on function public.accesso_progetti(uuid) is
  'Rispecchia accordoCompleto() di src/lib/accordo.ts: true se questo profilo '
  'può stare nell''area progetti. Le policy RESTRICTIVE di 0137 la usano per '
  'non far leggere o scrivere i progetti a chi ha l''Accordo incompleto.';

-- Serve a chi ha una sessione (authenticated); nessuno la esegue per altri.
grant execute on function public.accesso_progetti(uuid) to authenticated;

-- ------------------------------------------------- le tabelle dell'area progetti
-- Per ogni tabella e comando si aggiunge SOLO la condizione dell'Accordo.
-- Dove non esiste una policy permissiva per i membri (es. DELETE su tasks,
-- riservato all'accesso globale) non si aggiunge nulla: il varco non
-- servirebbe. Le policy si chiamano tutte varco_accordo_<comando>: sono per
-- tabella, quindi lo stesso nome può ripetersi.

-- Progetti: creare, leggere, lavorare
drop policy if exists varco_accordo_select on public.tasks;
create policy varco_accordo_select on public.tasks as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.tasks;
create policy varco_accordo_insert on public.tasks as restrictive
  for insert with check (public.accesso_progetti());
drop policy if exists varco_accordo_update on public.tasks;
create policy varco_accordo_update on public.tasks as restrictive
  for update using (public.accesso_progetti()) with check (public.accesso_progetti());

-- Materiali del progetto (le "deliverable")
drop policy if exists varco_accordo_select on public.deliverables;
create policy varco_accordo_select on public.deliverables as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.deliverables;
create policy varco_accordo_insert on public.deliverables as restrictive
  for insert with check (public.accesso_progetti());

-- Versioni depositate (il contenuto vero, con la catena di impronte)
drop policy if exists varco_accordo_select on public.deliverable_versions;
create policy varco_accordo_select on public.deliverable_versions as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.deliverable_versions;
create policy varco_accordo_insert on public.deliverable_versions as restrictive
  for insert with check (public.accesso_progetti());
drop policy if exists varco_accordo_delete on public.deliverable_versions;
create policy varco_accordo_delete on public.deliverable_versions as restrictive
  for delete using (public.accesso_progetti());

-- Storia degli stati del progetto
drop policy if exists varco_accordo_select on public.task_status_history;
create policy varco_accordo_select on public.task_status_history as restrictive
  for select using (public.accesso_progetti());

-- Pacchetto pubblicabile (video completo, copertina, liberatoria)
drop policy if exists varco_accordo_select on public.pacchetti_video;
create policy varco_accordo_select on public.pacchetti_video as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.pacchetti_video;
create policy varco_accordo_insert on public.pacchetti_video as restrictive
  for insert with check (public.accesso_progetti());
drop policy if exists varco_accordo_update on public.pacchetti_video;
create policy varco_accordo_update on public.pacchetti_video as restrictive
  for update using (public.accesso_progetti()) with check (public.accesso_progetti());

-- Pezzi del pacchetto
drop policy if exists varco_accordo_select on public.pacchetto_elementi;
create policy varco_accordo_select on public.pacchetto_elementi as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.pacchetto_elementi;
create policy varco_accordo_insert on public.pacchetto_elementi as restrictive
  for insert with check (public.accesso_progetti());
drop policy if exists varco_accordo_update on public.pacchetto_elementi;
create policy varco_accordo_update on public.pacchetto_elementi as restrictive
  for update using (public.accesso_progetti()) with check (public.accesso_progetti());
drop policy if exists varco_accordo_delete on public.pacchetto_elementi;
create policy varco_accordo_delete on public.pacchetto_elementi as restrictive
  for delete using (public.accesso_progetti());

-- Richieste di modifica: parlano del contenuto di un progetto, quindi
-- stanno dentro il varco.
drop policy if exists varco_accordo_select on public.richieste_modifica;
create policy varco_accordo_select on public.richieste_modifica as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.richieste_modifica;
create policy varco_accordo_insert on public.richieste_modifica as restrictive
  for insert with check (public.accesso_progetti());
drop policy if exists varco_accordo_update on public.richieste_modifica;
create policy varco_accordo_update on public.richieste_modifica as restrictive
  for update using (public.accesso_progetti()) with check (public.accesso_progetti());

-- Magazzino del gruppo: materiale di servizio dei progetti
drop policy if exists varco_accordo_select on public.documenti_magazzino;
create policy varco_accordo_select on public.documenti_magazzino as restrictive
  for select using (public.accesso_progetti());
drop policy if exists varco_accordo_insert on public.documenti_magazzino;
create policy varco_accordo_insert on public.documenti_magazzino as restrictive
  for insert with check (public.accesso_progetti());
drop policy if exists varco_accordo_delete on public.documenti_magazzino;
create policy varco_accordo_delete on public.documenti_magazzino as restrictive
  for delete using (public.accesso_progetti());

-- ---------------------------------------------------- i bucket dell'area progetti
-- Stessa idea sui file: i quattro bucket dei progetti restano chiusi a chi ha
-- l'Accordo incompleto, gli altri no. Il filtro sul bucket è necessario perché
-- storage.objects è una tabella sola per tutti: una policy restrictive senza
-- quel filtro chiuderebbe anche il bucket "profili", cioè il posto da cui si
-- carica l'Accordo — il modo per uscire dal varco.
drop policy if exists varco_accordo_select on storage.objects;
create policy varco_accordo_select on storage.objects as restrictive
  for select using (
    bucket_id not in ('originali', 'finali', 'revisioni', 'magazzino')
    or public.accesso_progetti()
  );
drop policy if exists varco_accordo_insert on storage.objects;
create policy varco_accordo_insert on storage.objects as restrictive
  for insert with check (
    bucket_id not in ('originali', 'finali', 'revisioni', 'magazzino')
    or public.accesso_progetti()
  );
drop policy if exists varco_accordo_update on storage.objects;
create policy varco_accordo_update on storage.objects as restrictive
  for update using (
    bucket_id not in ('originali', 'finali', 'revisioni', 'magazzino')
    or public.accesso_progetti()
  );
drop policy if exists varco_accordo_delete on storage.objects;
create policy varco_accordo_delete on storage.objects as restrictive
  for delete using (
    bucket_id not in ('originali', 'finali', 'revisioni', 'magazzino')
    or public.accesso_progetti()
  );

-- --------------------------------------------------------------- come provarlo
-- supabase/tests/verifica_permessi.sql ha due prove nuove: con l'Accordo
-- completo si lavora come prima, senza Accordo non si vede più nulla
-- dell'area progetti. Girano in transazione con rollback: non modificano
-- niente.
--
-- Nota per chi legge fra un anno: questa migrazione NON sostituisce il varco
-- applicativo (proxy + layout). Sono due strati apposta: l'app manda la
-- persona nella pagina giusta e le spiega cosa manca, il database non si fida
-- dell'app.
