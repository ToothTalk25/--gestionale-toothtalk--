-- =====================================================================
-- 0143_policy_solo_a_chi_ha_la_sessione.sql
-- =====================================================================
-- Perché. 32 policy del gestionale erano assegnate a PUBLIC — cioè a chiunque,
-- anche a chi non ha fatto l'accesso (ruolo `anon`). Non è un permesso voluto:
-- è il valore predefinito di `create policy` quando non si scrive `to …`, e in
-- qualche caso è stato scritto `to public` di proposito agli inizi del
-- progetto. Sono le "varco accordo" (chi ha l'accordo da completare deve poter
-- lavorare), le sezioni riservate del Registro e lo storage.
--
-- Tenerle aperte a `anon` significa che un visitatore con la sola chiave
-- pubblica fa valutare quelle espressioni — e, dopo la 0144 (permessi delle
-- funzioni), non avrebbe nemmeno il diritto di eseguire le funzioni che ci
-- stanno dentro. Meglio chiudere prima.
--
-- Cosa cambia: le stesse espressioni, gli stessi permessi, ma solo per chi ha
-- una sessione (`authenticated`). Nessuna persona che usa il gestionale perde
-- niente: chi era coperto da PUBLIC lo è ancora. `service_role` non passa dalle
-- policy, quindi resta come prima.
--
-- Il bucket `branding`: la sua policy di lettura larga (`branding_public_read`)
-- lasciava ELENCARE i file a chiunque, anche senza accesso. Un bucket pubblico
-- serve gli oggetti anche senza policy, quindi si toglie e basta. Il gestionale
-- non usa quel bucket (nessun riferimento nel codice).
--
-- Le due policy dello schema `cron` (`job`, `job_run_details`) restano come
-- sono: quello schema non è esposto all'API.
-- =====================================================================

-- ------------------------------------------------ varco accordo: progetto
alter policy varco_accordo_select on public.tasks to authenticated;
alter policy varco_accordo_insert on public.tasks to authenticated;
alter policy varco_accordo_update on public.tasks to authenticated;
alter policy varco_accordo_select on public.task_status_history to authenticated;

alter policy varco_accordo_select on public.deliverables to authenticated;
alter policy varco_accordo_insert on public.deliverables to authenticated;

alter policy varco_accordo_select on public.deliverable_versions to authenticated;
alter policy varco_accordo_insert on public.deliverable_versions to authenticated;
alter policy varco_accordo_delete on public.deliverable_versions to authenticated;

-- ------------------------------------------------ varco accordo: pacchetti video
alter policy varco_accordo_select on public.pacchetti_video to authenticated;
alter policy varco_accordo_insert on public.pacchetti_video to authenticated;
alter policy varco_accordo_update on public.pacchetti_video to authenticated;

alter policy varco_accordo_select on public.pacchetto_elementi to authenticated;
alter policy varco_accordo_insert on public.pacchetto_elementi to authenticated;
alter policy varco_accordo_update on public.pacchetto_elementi to authenticated;
alter policy varco_accordo_delete on public.pacchetto_elementi to authenticated;

-- ------------------------------------------------ varco accordo: richieste e magazzino
alter policy varco_accordo_select on public.richieste_modifica to authenticated;
alter policy varco_accordo_insert on public.richieste_modifica to authenticated;
alter policy varco_accordo_update on public.richieste_modifica to authenticated;

alter policy varco_accordo_select on public.documenti_magazzino to authenticated;
alter policy varco_accordo_insert on public.documenti_magazzino to authenticated;
alter policy varco_accordo_delete on public.documenti_magazzino to authenticated;

-- ------------------------------------------------ varco accordo: storage
alter policy varco_accordo_select on storage.objects to authenticated;
alter policy varco_accordo_insert on storage.objects to authenticated;
alter policy varco_accordo_update on storage.objects to authenticated;
alter policy varco_accordo_delete on storage.objects to authenticated;

-- ------------------------------------------------ sezioni riservate del Registro
-- Le espressioni qui dentro chiedono già is_admin(): il ruolo era l'unica cosa
-- che mancava per non farle valutare anche a chi non ha la sessione.
alter policy controlli_integrita_select on public.controlli_integrita to authenticated;
alter policy pec_da_inviare_select on public.pec_da_inviare to authenticated;

alter policy richieste_admin_select on public.richieste_liberatoria to authenticated;
alter policy richieste_admin_insert on public.richieste_liberatoria to authenticated;
alter policy richieste_admin_update on public.richieste_liberatoria to authenticated;

-- ------------------------------------------------ il bucket che non si usa
-- Un bucket pubblico (`public = true`) serve gli oggetti senza bisogno di
-- policy: questa permetteva solo di elencarli a chiunque, anche senza accesso.
drop policy if exists branding_public_read on storage.objects;

-- Controllo: in public e storage non deve restare nessuna policy assegnata a
-- PUBLIC o ad anon (le due di cron sono fuori da questi schemi).
do $$
declare
  rimaste text;
begin
  select string_agg(x.schema || '.' || x.tabella || ' — ' || x.policy, ', ' order by 1)
    into rimaste
    from (
      select n.nspname as schema, c.relname as tabella, p.polname as policy
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'storage')
         and (
           p.polroles = '{0}'::oid[]
           or exists (select 1 from pg_roles r where r.oid = any(p.polroles) and r.rolname = 'anon')
         )
    ) x;

  if rimaste is not null then
    raise exception 'Policy ancora aperte a chi non ha la sessione: %', rimaste;
  end if;
  raise notice 'Nessuna policy di public/storage e'' assegnata a PUBLIC o anon.';
end;
$$;
