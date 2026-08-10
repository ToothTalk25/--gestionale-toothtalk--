-- =====================================================================
-- 0025_privacy_profili.sql — profilo visibile solo a sé stessi e all'accesso
-- globale; niente matricola o corso di studi
-- =====================================================================
-- L'anagrafica completa (nascita, luogo, università, foto, accordo) è
-- personale: la vedono solo il partecipante e chi ha accesso globale. Gli
-- altri compagni del gruppo vedono solo il NOME nei contesti di progetto
-- (es. "chi ha caricato questo file"), tramite la funzione nomi_visibili.
-- Vengono rimossi matricola e corso di studi: è implicito che i partecipanti
-- studino odontoiatria.
-- =====================================================================

alter table public.profiles
  drop column if exists matricola,
  drop column if exists corso_studi;

-- Il profilo completo è personale.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- ------------------------------------------------------- nomi visibili
-- Solo id, nome e email, e solo per utenti che condividono un gruppo con
-- chi chiama (o per l'accesso globale). Serve ai contesti di progetto senza
-- esporre l'anagrafica.
create or replace function public.nomi_visibili(p_ids uuid[])
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.email
  from public.profiles pr
  where pr.id = any(p_ids)
    and (pr.id = auth.uid() or public.is_admin() or public.shares_polo_with(pr.id));
$$;

grant execute on function public.nomi_visibili(uuid[]) to authenticated;
