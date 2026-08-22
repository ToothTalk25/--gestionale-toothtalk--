-- =====================================================================
-- 0091_dichiarazione_identita_riservata.sql — girato con dichiarazione
--                                              di identità: accesso
--                                              ristretto a Coordinatore
--                                              + chi l'ha caricato
-- =====================================================================
-- Oggi (0003_storage.sql, policy originali_select) chiunque possa leggere
-- il polo vede tutto il bucket 'originali', incluso il video_grezzo che,
-- per i task con persone esterne coinvolte, contiene in apertura la
-- dichiarazione di identità e recapito dell'intervistato (Art. 4.1
-- Protocollo Operativo) — nome, cognome, email/PEC pronunciati a video.
--
-- Non è un dettaglio: è un dato personale di un terzo che non ha aderito
-- al Progetto, visibile oggi a chiunque abbia accesso al polo, non solo a
-- chi ha girato o a chi deve effettivamente montare quel contenuto.
--
-- Questa migrazione restringe la visibilità SOLO per i file video_grezzo
-- e audio dei task con coinvolge_terzi = true: da quel momento sono
-- leggibili soltanto dal Titolare e da chi li ha caricati. Per tutti gli
-- altri materiali di lavorazione (task senza terzi coinvolti) non cambia
-- nulla: restano condivisi con tutto il polo come sempre, perché servono
-- al lavoro collettivo di montaggio.
--
-- Se il montaggio lo fa un Collaboratore diverso da chi ha girato, il
-- Titolare valuta caso per caso se condividere il file: non esiste un
-- meccanismo automatico per "aggiungere" un secondo Collaboratore
-- autorizzato — a questa scala non serve, e complicherebbe la policy
-- senza un reale beneficio.
-- =====================================================================

create or replace function public.storage_dichiarazione_riservata(p_name text)
returns boolean language sql stable as $$
  select coalesce(
    (
      select t.coinvolge_terzi
        from public.deliverable_versions v
        join public.deliverables d on d.id = v.deliverable_id
        join public.tasks t on t.id = d.task_id
       where v.bucket = 'originali'
         and v.storage_path = p_name
         and d.kind in ('video_grezzo', 'audio')
       limit 1
    ),
    false
  );
$$;

comment on function public.storage_dichiarazione_riservata(text) is
  'True se il file (bucket originali) è girato o audio di un task con '
  'persone esterne coinvolte: può contenere la dichiarazione di identità e '
  'recapito dell''intervistato (Art. 4.1 Protocollo) e va quindi visto solo '
  'da chi lo ha caricato e dal Titolare, non da tutto il polo.';

drop policy if exists originali_select on storage.objects;
create policy originali_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'originali'
    and public.can_read_polo(public.storage_polo_id(name))
    and (
      not public.storage_dichiarazione_riservata(name)
      or public.is_admin()
      or exists (
        select 1
          from public.deliverable_versions v
         where v.bucket = 'originali'
           and v.storage_path = name
           and v.uploaded_by = auth.uid()
      )
    )
  );

-- Stessa restrizione sui METADATI (nome file, data, chi l'ha caricato):
-- senza questa, il file non sarebbe scaricabile ma la sua esistenza e il
-- nome sarebbero comunque visibili a tutto il polo tramite la riga in
-- deliverable_versions — difesa in profondità, non solo sui byte.
drop policy if exists versions_select on public.deliverable_versions;
create policy versions_select on public.deliverable_versions
  for select to authenticated
  using (
    public.can_read_polo(public.polo_of_deliverable(deliverable_id))
    and (
      bucket <> 'originali'
      or not public.storage_dichiarazione_riservata(storage_path)
      or public.is_admin()
      or uploaded_by = auth.uid()
    )
  );
