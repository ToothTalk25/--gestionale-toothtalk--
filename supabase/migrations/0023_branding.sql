-- =====================================================================
-- 0023_branding.sql — bucket pubblico per i materiali di marca
-- =====================================================================
-- Il logo (e futuri materiali) devono essere raggiungibili da un URL
-- pubblico per comparire nelle email di Supabase Auth (reset password,
-- conferma account, inviti). Un bucket pubblico dedicato evita di aprire
-- quelli dei materiali, che restano privati.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('branding', 'branding', true, 10485760)
on conflict (id) do update set public = true;

-- Chiunque (anche non autenticato) può leggere: è materiale di marca,
-- pensato per essere incorporato nelle email.
drop policy if exists branding_public_read on storage.objects;
create policy branding_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'branding');
