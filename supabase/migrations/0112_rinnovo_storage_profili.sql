-- =====================================================================
-- 0112_rinnovo_storage_profili.sql — permesso di storage per i rinnovi
-- =====================================================================
-- Il bucket "profili" lascia scrivere SOLO nei tipi 'foto' e 'accordo'
-- (policy profili_insert in 0024): il documento di rinnovo dell'accordo
-- (Art. 9.1) vive in "<uid>/rinnovo/..." e senza queste policy il
-- caricamento dal client verrebbe respinto dall'RLS dello storage prima
-- ancora di arrivare alla server action. Si estende il permesso SOLO al
-- proprio spazio (chi carica il proprio rinnovo) e, per la lettura, anche
-- all'admin (il Coordinatore deve poter verificare il documento firmato).
-- Le server action passano comunque dal service_role: queste policy
-- servono al caricamento diretto dal browser, come per l'accordo.
-- =====================================================================

drop policy if exists profili_insert_rinnovo on storage.objects;
create policy profili_insert_rinnovo on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profili'
    and public.storage_profilo_uid(name) = auth.uid()
    and public.storage_profilo_tipo(name) = 'rinnovo'
  );

drop policy if exists profili_select_rinnovo on storage.objects;
create policy profili_select_rinnovo on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profili'
    and public.storage_profilo_tipo(name) = 'rinnovo'
    and (
      public.storage_profilo_uid(name) = auth.uid()
      or public.is_admin()
    )
  );
