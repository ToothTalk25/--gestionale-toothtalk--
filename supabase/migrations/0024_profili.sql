-- =====================================================================
-- 0024_profili.sql — profilo personale: anagrafica, foto, università,
--                   accordo editoriale
-- =====================================================================
-- Ogni partecipante compila il proprio profilo: dati anagrafici, foto,
-- università e corso di studi. L'accordo editoriale (PDF firmato) viene
-- caricato nel suo spazio e, una volta registrato, inviato automaticamente
-- via PEC a chi ha accesso globale — così esiste un registro dei
-- partecipanti per sede.
-- =====================================================================

alter table public.profiles
  add column if not exists data_nascita date,
  add column if not exists luogo_nascita text,
  add column if not exists matricola text,
  add column if not exists corso_studi text,
  add column if not exists universita text,
  add column if not exists foto_path text,
  add column if not exists accordo_path text,
  add column if not exists accordo_sha256 text,
  add column if not exists accordo_caricato_at timestamptz;

comment on column public.profiles.accordo_path is
  'Percorso nel bucket profili del PDF dell''accordo editoriale firmato.';
comment on column public.profiles.accordo_sha256 is
  'Impronta SHA-256 dell''accordo: è ciò che viene certificato via PEC.';
comment on column public.profiles.accordo_caricato_at is
  'Quando il partecipante ha caricato l''accordo (e la PEC è partita).';

-- ------------------------------------------------------------ storage
-- Bucket privato dedicato al profilo: la foto è visibile anche a chi
-- condivide il gruppo, l'accordo solo al proprietario e a chi ha accesso
-- globale.
insert into storage.buckets (id, name, public, file_size_limit)
values ('profili', 'profili', false, 20971520)
on conflict (id) do update set public = false;

-- Primo segmento del path = user_id, secondo = tipo ('foto' | 'accordo').
create or replace function public.storage_profilo_uid(p_name text)
returns uuid language sql immutable as $$
  select public.try_uuid((storage.foldername(p_name))[1]);
$$;

create or replace function public.storage_profilo_tipo(p_name text)
returns text language sql immutable as $$
  select (storage.foldername(p_name))[2];
$$;

drop policy if exists profili_select on storage.objects;
create policy profili_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profili'
    and public.storage_profilo_tipo(name) = 'foto'
    and (
      public.storage_profilo_uid(name) = auth.uid()
      or public.is_admin()
      or public.shares_polo_with(public.storage_profilo_uid(name))
    )
  );

drop policy if exists profili_select_accordo on storage.objects;
create policy profili_select_accordo on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profili'
    and public.storage_profilo_tipo(name) = 'accordo'
    and (
      public.storage_profilo_uid(name) = auth.uid()
      or public.is_admin()
    )
  );

-- Ognuno scrive solo nel proprio spazio, e solo nei tipi previsti.
drop policy if exists profili_insert on storage.objects;
create policy profili_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profili'
    and public.storage_profilo_uid(name) = auth.uid()
    and public.storage_profilo_tipo(name) in ('foto', 'accordo')
  );

drop policy if exists profili_delete on storage.objects;
create policy profili_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profili'
    and (
      public.storage_profilo_uid(name) = auth.uid()
      or public.is_admin()
    )
  );
