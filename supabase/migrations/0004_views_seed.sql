-- =====================================================================
-- 0004_views_seed.sql : viste di comodo + dati iniziali
-- =====================================================================

-- Le viste ereditano le RLS delle tabelle sottostanti (security_invoker).
create or replace view public.v_task_overview
with (security_invoker = true) as
select
  t.id,
  t.polo_id,
  p.nome  as polo_nome,
  p.slug  as polo_slug,
  t.titolo,
  t.status,
  t.scadenza,
  t.locked,
  t.updated_at,
  count(v.id) filter (where v.origin = 'originale')  as n_consegne_originali,
  count(v.id) filter (where v.origin = 'admin_edit') as n_versioni_admin,
  max(v.uploaded_at) filter (where v.origin = 'originale') as ultima_consegna,
  bool_or(d.kind = 'liberatoria') as ha_liberatoria
from public.tasks t
join public.poli p on p.id = t.polo_id
left join public.deliverables d on d.task_id = t.id
left join public.deliverable_versions v on v.deliverable_id = d.id
group by t.id, p.nome, p.slug;

-- Confronto "originale vs versione finale" per una singola deliverable.
create or replace view public.v_confronto_versioni
with (security_invoker = true) as
select
  d.id            as deliverable_id,
  d.task_id,
  d.kind,
  orig.id         as originale_version_id,
  orig.file_name  as originale_file,
  orig.sha256     as originale_sha256,
  orig.sealed_at  as originale_sigillata_il,
  orig.uploaded_by as consegnata_da,
  fin.id          as finale_version_id,
  fin.file_name   as finale_file,
  fin.sha256      as finale_sha256,
  fin.uploaded_at as finale_caricata_il,
  (orig.id is not null and fin.id is not null) as modificata_da_admin
from public.deliverables d
left join lateral (
  select * from public.deliverable_versions v
  where v.deliverable_id = d.id and v.origin = 'originale'
  order by v.version_no asc limit 1
) orig on true
left join lateral (
  select * from public.deliverable_versions v
  where v.deliverable_id = d.id and v.origin = 'admin_edit'
  order by v.version_no desc limit 1
) fin on true;

grant select on public.v_task_overview, public.v_confronto_versioni to authenticated;

-- ---------------------------------------------------------------- seed
insert into public.poli (nome, slug, citta) values
  ('Insubria', 'insubria', 'Varese'),
  ('Genova',   'genova',   'Genova')
on conflict (slug) do nothing;
