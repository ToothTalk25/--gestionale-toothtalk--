-- =====================================================================
-- 0125_ripristino_eliminazione_lavorazione.sql
-- =====================================================================
-- 0078 aveva riscritto la guardia append-only per aggiungere l eccezione
-- Art. 17 GDPR, ma nel ramo DELETE ha lasciato un rifiuto incondizionato:
-- da allora nessuna riga di deliverable_versions può essere cancellata.
-- Conseguenze verificate sul database di produzione:
--   * il pulsante Elimina sui materiali di lavorazione non funziona;
--   * eliminare un progetto non funziona: la RPC elimina_progetto (0035)
--     cancella prima il pacchetto e poi le versioni, contando proprio sul
--     fatto che a quel punto la cancellazione passi.
--
-- La regola giusta è quella di 0015: il registro è immutabile per ciò che
-- ha valore probatorio, cioè per i file dell archivio pubblicabile
-- agganciati a un pacchetto NON più in bozza. Tutto il resto (materiali di
-- lavorazione, file mai entrati in un pacchetto, pacchetti ancora in bozza)
-- resta eliminabile, come dice CONTESTO.md sulla zona di lavoro.
-- Le altre due difese del sigillato restano intatte: il vincolo di chiave
-- esterna on delete restrict e fn_elementi_congelati.
-- =====================================================================

create or replace function public.fn_versions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.bucket = 'finali' and exists (
      select 1
      from public.pacchetto_elementi pe
      join public.pacchetti_video p on p.id = pe.pacchetto_id
      where pe.version_id = old.id and p.stato <> 'bozza'
    ) then
      raise exception 'Video completo già sigillato: i file non si eliminano più'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- ECCEZIONE CHIRURGICA Art. 17 GDPR — SOLO per le consegne originali.
  -- L'unico update ammesso è marcare la revoca: revocato_gdpr passa da
  -- false a true e revocato_at viene valorizzato. NIENT'altro può cambiare.
  if old.origin = 'originale' then
    if not (
      new.revocato_gdpr = true
      and old.revocato_gdpr = false
      and new.revocato_at is not null
      and old.revocato_at is null
      and (new.sha256, new.storage_path, new.record_hash, new.prev_record_hash,
           new.uploaded_by, new.uploaded_at, new.version_no, new.origin,
           new.deliverable_id, new.bucket, new.file_name, new.mime_type,
           new.size_bytes, new.sealed_at, new.note, new.archiviato_esterno)
          is not distinct from
          (old.sha256, old.storage_path, old.record_hash, old.prev_record_hash,
           old.uploaded_by, old.uploaded_at, old.version_no, old.origin,
           old.deliverable_id, old.bucket, old.file_name, old.mime_type,
           old.size_bytes, old.sealed_at, old.note, old.archiviato_esterno)
    ) then
      raise exception 'Consegna originale % sigillata il %: immutabile (unica eccezione: revoca consenso Art.17 GDPR)',
        old.id, old.sealed_at using errcode = '42501';
    end if;
  end if;

  -- Sulle versioni admin resta modificabile solo la nota descrittiva.
  if (new.sha256, new.storage_path, new.record_hash, new.prev_record_hash,
      new.uploaded_by, new.uploaded_at, new.version_no, new.origin, new.deliverable_id)
     is distinct from
     (old.sha256, old.storage_path, old.record_hash, old.prev_record_hash,
      old.uploaded_by, old.uploaded_at, old.version_no, old.origin, old.deliverable_id)
  then
    raise exception 'I dati probatori di una versione non sono modificabili'
      using errcode = '42501';
  end if;

  return new;
end $$;
