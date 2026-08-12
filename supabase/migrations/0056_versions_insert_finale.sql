-- =====================================================================
-- 0056_versions_insert_finale.sql — manca la policy INSERT per il bucket
-- 'finali': mai esistita da quando esiste il pacchetto pubblicabile
-- (0006_pacchetti_pec.sql), scoperta durante un primo test reale di
-- caricamento del video nel pacchetto.
-- =====================================================================

create or replace function public.pacchetto_bozza_per_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not t.locked
       and coalesce(
             (select p.stato from public.pacchetti_video p
              where p.task_id = d.task_id and p.stato <> 'annullato'
              limit 1),
             'bozza'
           ) = 'bozza'
    from public.deliverables d
    join public.tasks t on t.id = d.task_id
    where d.id = p_deliverable
  ), false);
$$;

-- Il membro deposita gli elementi del pacchetto ("Video completo"),
-- finché il pacchetto è ancora in bozza — stessa logica di
-- versions_insert_originale, ma per il bucket certificato.
drop policy if exists versions_insert_finale on public.deliverable_versions;
create policy versions_insert_finale on public.deliverable_versions
  for insert to authenticated
  with check (
    origin = 'originale'
    and bucket = 'finali'
    and uploaded_by = auth.uid()
    and public.is_member_of(public.polo_of_deliverable(deliverable_id))
    and public.pacchetto_bozza_per_deliverable(deliverable_id)
  );
