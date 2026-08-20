-- =====================================================================
-- 0078_revoca_gdpr_trigger.sql — eccezione chirurgica Art. 17 GDPR
-- =====================================================================
-- Contesto: la revoca del consenso (immagine/voce = dato biometrico) da
-- parte di un Front Man è incondizionata (GDPR Art. 7.3 e 17). I byte
-- fisici del video/audio grezzo vanno eliminati dallo storage Supabase.
--
-- La riga nel registro probatorio RESTA per sempre (append-only): è la
-- prova documentale dell'operazione. Per questo si aggiungono due colonne
-- che marcano la revoca sulla singola versione:
--   revocato_gdpr boolean  (false -> true, solo in questo verso)
--   revocato_at   timestamptz
--
-- IMPORTANTE — PERCHÉ QUESTA NON È UN BUCO NEL MURO:
-- fn_versions_append_only (0001_schema.sql) vieta QUALSIASI update/delete
-- sulle consegne originali. L'unica estensione ammessa qui è una
-- transizione one-way strettissima: quando old.origin = 'originale',
-- l'update passa SOLO se l'unica differenza tra old e new è
-- (revocato_gdpr: false -> true, revocato_at: null -> valorizzato).
-- Tutte le altre colonne probatorie (sha256, storage_path, record_hash,
-- prev_record_hash, uploaded_by, uploaded_at, version_no, origin,
-- deliverable_id, bucket, file_name, mime_type, size_bytes, sealed_at,
-- note, archiviato_esterno) devono restare IDENTICHE. Il passaggio
-- contrario (true -> false) o qualunque altra modifica è bloccato.
--
-- La cancellazione vera avviene sullo Storage (Supabase Storage API), che
-- il trigger Postgres non vede: stesso principio di 0043_archiviazione_
-- esterna.sql — la riga e l'hash restano per sempre come prova, i byte no.
-- =====================================================================

alter table public.deliverable_versions
  add column if not exists revocato_gdpr boolean not null default false;

alter table public.deliverable_versions
  add column if not exists revocato_at timestamptz;

comment on column public.deliverable_versions.revocato_gdpr is
  'Revoca del consenso (Art. 17 GDPR) applicata a questa consegna originale '
  'di un soggetto on-screen: il file fisico è stato purgato dallo storage. '
  'Transizione one-way (false -> true), mai il contrario. La riga e lo '
  'SHA256 restano: la prova legale è nell''impronta e nel log di audit.';
comment on column public.deliverable_versions.revocato_at is
  'Timestamp esatto della revoca (Art. 17 GDPR).';

-- Riscrive la guardia append-only (stessa firma, stesso trigger
-- trg_versions_append_only di 0001_schema.sql: il trigger punta alla
-- funzione per nome, quindi create or replace è sufficiente).
create or replace function public.fn_versions_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registro append-only: la versione % non può essere cancellata', old.id
      using errcode = '42501';
  end if;

  -- ECCEZIONE CHIRURGICA Art. 17 GDPR — SOLO per le consegne originali.
  -- L'unico update ammesso è marcare la revoca: revocato_gdpr passa da
  -- false a true e revocato_at viene valorizzato. NIENT'altro può cambiare.
  -- Se old.origin = 'originale' e la transizione non è esattamente questa,
  -- il comportamento è identico a prima: riga sigillata, immutabile.
  if old.origin = 'originale' then
    if not (
      -- 1) la marcatura della revoca è l'UNICA differenza consentita:
      new.revocato_gdpr = true
      and old.revocato_gdpr = false
      and new.revocato_at is not null
      and old.revocato_at is null
      -- 2) tutte le altre colonne sono identiche:
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
