-- =====================================================================
-- 0109_dichiarazione_solo_admin.sql — il girato di dichiarazione resta
--                                    leggibile solo dal Coordinatore
-- =====================================================================
-- Protocollo Art. 4.1: il video di dichiarazione contiene identità e
-- recapiti dell'intervistato pronunciati a video. È un dato personale di
-- un terzo che non ha aderito al Progetto: chi lo ha girato lo ha già
-- rivisto sul proprio dispositivo PRIMA di confermare il caricamento
-- (in-app, oppure nella galleria del telefono), quindi non ha più bisogno
-- di accedervi dopo il deposito.
--
-- 0091 aveva impostato la visibilità a "chi l'ha caricato + Titolare".
-- Questo file la restringe al solo Titolare per i FILE (bucket originali)
-- e per le righe di deliverable_versions delle dichiarazioni: niente più
-- clausola `or uploaded_by = auth.uid()`. Chi non è admin non può più
-- vedere il video né scaricarlo, in nessun momento — prima del sigillo
-- come dopo l'archiviazione su Drive.
--
-- Resta però necessario mostrare alla persona che ha caricato che
-- l'elemento esiste (slot 7/7b compilato) e lasciarle il pulsante
-- "Segnala errore": a questo serve la funzione SECURITY DEFINER
-- `pacchetto_elementi_meta`, che espone i SOLI metadati dell'elemento
-- (nome file, dimensione, data — mai lo storage_path), senza passare
-- dalla RLS di deliverable_versions. La pagina del task la usa al posto
-- della join `deliverable_versions!inner` che, senza la clausola per
-- l'autore, avrebbe fatto sparire lo slot.
-- =====================================================================

-- Il commento dell'helper riflette la nuova regola (solo Titolare).
comment on function public.storage_dichiarazione_riservata(text) is
  'True se il file (bucket originali) è girato o audio di un task con '
  'persone esterne coinvolte: può contenere la dichiarazione di identità e '
  'recapito dell''intervistato (Art. 4.1 Protocollo) e va quindi visto e '
  'scaricato solo dal Titolare, non da chi lo ha caricato né dal resto '
  'del polo.';

-- Storage: il file della dichiarazione non è più leggibile dall'autore,
-- solo dal Titolare. Il membro che ha caricato vede solo i metadati
-- (via pacchetto_elementi_meta) e può segnalare un errore.
drop policy if exists originali_select on storage.objects;
create policy originali_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'originali'
    and public.can_read_polo(public.storage_polo_id(name))
    and (
      not public.storage_dichiarazione_riservata(name)
      or public.is_admin()
    )
  );

-- Stessa restrizione sui METADATI (riga in deliverable_versions): senza
-- questo, il nome del file e la data resterebbero leggibili a tutto il
-- polo tramite la riga — difesa in profondità, non solo sui byte.
-- La UI del pacchetto non dipende più da questa policy per gli elementi
-- (usa pacchetto_elementi_meta), quindi la clausola per l'autore si può
-- togliere senza far sparire lo slot di caricamento.
drop policy if exists versions_select on public.deliverable_versions;
create policy versions_select on public.deliverable_versions
  for select to authenticated
  using (
    public.can_read_polo(public.polo_of_deliverable(deliverable_id))
    and (
      bucket <> 'originali'
      or not public.storage_dichiarazione_riservata(storage_path)
      or public.is_admin()
    )
  );

-- --------------------------------------------------------------- helper

-- Metadati degli elementi di un pacchetto per chi può leggere il polo
-- (o l'admin): ruolo, version_id, nome file, impronta, dimensione e data
-- di caricamento. NIENTE storage_path: chi non è admin non deve poter
-- derivare da qui il percorso del file in storage. SECURITY DEFINER perché
-- deve continuare a rispondere anche se la RLS di deliverable_versions
-- nasconde la riga della dichiarazione a chi non è admin.
create or replace function public.pacchetto_elementi_meta(p_pacchetto uuid)
returns table (
  ruolo             public.ruolo_elemento,
  version_id        uuid,
  file_name         text,
  sha256            text,
  size_bytes        bigint,
  uploaded_at       timestamptz,
  archiviato_esterno boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_polo uuid;
begin
  select t.polo_id into v_polo
    from public.pacchetti_video p
    join public.tasks t on t.id = p.task_id
   where p.id = p_pacchetto;

  if v_polo is null then
    raise exception 'Pacchetto non trovato' using errcode = 'P0001';
  end if;

  if not (public.is_admin() or public.can_read_polo(v_polo)) then
    raise exception 'Accesso negato' using errcode = '42501';
  end if;

  return query
    select pe.ruolo, v.id, v.file_name, v.sha256, v.size_bytes,
           v.uploaded_at, v.archiviato_esterno
      from public.pacchetto_elementi pe
      join public.deliverable_versions v on v.id = pe.version_id
     where pe.pacchetto_id = p_pacchetto;
end $$;

grant execute on function public.pacchetto_elementi_meta(uuid) to authenticated;
