-- =====================================================================
-- 0007_poli.sql — elenco reale dei poli, al posto del seed provvisorio
-- =====================================================================
-- 0004_views_seed.sql aveva inserito Insubria e Genova come segnaposto.
-- Genova non è mai stato un polo reale: lo rimuoviamo (solo se non ha task
-- collegate, per non perdere dati per errore). Insubria resta. Si aggiungono
-- i poli reali: Milano, Palermo, Messina, Chieti, e un polo "Spagna" per la
-- rete internazionale (senza città: è multi-sede).
-- =====================================================================

delete from public.poli p
where p.slug = 'genova'
  and not exists (select 1 from public.tasks t where t.polo_id = p.id);

insert into public.poli (nome, slug, citta) values
  ('Milano',  'milano',  'Milano'),
  ('Palermo', 'palermo', 'Palermo'),
  ('Messina', 'messina', 'Messina'),
  ('Chieti',  'chieti',  'Chieti'),
  ('Spagna',  'spagna',  null)
on conflict (slug) do nothing;
