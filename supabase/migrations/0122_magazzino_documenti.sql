-- =====================================================================
-- 0122_magazzino_documenti.sql — magazzino documenti del gruppo
-- =====================================================================
-- Ogni gruppo ha un proprio magazzino: moduli, guide, immagini di
-- servizio, materiali che servono per lavorare e che non appartengono a
-- un singolo progetto. Sta nella zona di lavoro (vedi CONTESTO.md):
-- chi partecipa deposita, scarica ed elimina liberamente. Nessun valore
-- probatorio e nessuna catena di impronte — quella resta sui materiali
-- dei progetti (deliverable_versions) e non va duplicata qui: se il
-- magazzino diventasse un secondo registro, la prima cancellazione
-- libera lo renderebbe incoerente.
--
-- Bucket dedicato invece di un prefisso di "originali": è la stessa
-- ragione per cui i bucket sono separati, cioè che una policy sbagliata
-- qui non può esporre né toccare l'archivio dei progetti.
--
-- Convenzione di path, verificata dalle policy:
--   {polo_id}/{uuid}__{nomefile}
--   ^^^^^^^^ il primo segmento è la chiave di autorizzazione, come negli
--            altri bucket (public.storage_polo_id legge proprio quello)
-- =====================================================================

create table if not exists public.documenti_magazzino (
  id            uuid primary key default gen_random_uuid(),
  polo_id       uuid not null references public.poli(id) on delete cascade,
  caricato_da   uuid references public.profiles(id) on delete set null,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint not null check (size_bytes > 0),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  creato_at     timestamptz not null default now()
);

create index if not exists documenti_magazzino_polo_idx
  on public.documenti_magazzino (polo_id, creato_at desc);

alter table public.documenti_magazzino enable row level security;

-- Chi vede il gruppo vede il magazzino, e chi lo vede può anche
-- depositare e togliere: è materiale di servizio, non un registro.
-- Nessuna policy di UPDATE: un documento non si riscrive, si sostituisce
-- con un file nuovo — così due file con lo stesso nome non si
-- sovrascrivono mai in silenzio.
drop policy if exists documenti_magazzino_select on public.documenti_magazzino;
create policy documenti_magazzino_select on public.documenti_magazzino
  for select to authenticated
  using (public.can_read_polo(polo_id));

drop policy if exists documenti_magazzino_insert on public.documenti_magazzino;
create policy documenti_magazzino_insert on public.documenti_magazzino
  for insert to authenticated
  with check (public.can_read_polo(polo_id) and caricato_da = auth.uid());

drop policy if exists documenti_magazzino_delete on public.documenti_magazzino;
create policy documenti_magazzino_delete on public.documenti_magazzino
  for delete to authenticated
  using (public.can_read_polo(polo_id));

grant select, insert, delete on public.documenti_magazzino to authenticated;

-- ------------------------------------------------------ bucket magazzino

insert into storage.buckets (id, name, public, file_size_limit)
values ('magazzino', 'magazzino', false, 104857600)   -- 100 MB per file
on conflict (id) do update set public = false;

-- Path del magazzino: un solo segmento di cartella ({polo_id}/{file}),
-- non tre come i materiali di progetto: qui non esiste un deliverable a
-- cui agganciarsi.
create or replace function public.storage_path_magazzino_valido(p_name text)
returns boolean language sql immutable as $$
  select array_length(storage.foldername(p_name), 1) = 1
     and public.try_uuid((storage.foldername(p_name))[1]) is not null;
$$;

drop policy if exists magazzino_select on storage.objects;
create policy magazzino_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'magazzino'
    and public.can_read_polo(public.storage_polo_id(name))
  );

drop policy if exists magazzino_insert on storage.objects;
create policy magazzino_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'magazzino'
    and public.storage_path_magazzino_valido(name)
    and public.can_read_polo(public.storage_polo_id(name))
  );

-- DELETE consentito a chi appartiene al gruppo (o ha accesso globale):
-- è la zona di lavoro, si sbaglia e si cancella. Il caricamento deve
-- usare upsert: false, perché su questo bucket non esiste policy di UPDATE.
drop policy if exists magazzino_delete on storage.objects;
create policy magazzino_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'magazzino'
    and public.can_read_polo(public.storage_polo_id(name))
  );
