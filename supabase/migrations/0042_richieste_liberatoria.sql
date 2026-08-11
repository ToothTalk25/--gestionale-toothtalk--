-- =====================================================================
-- 0042_richieste_liberatoria.sql — invio e upload sicuro della liberatoria
-- =====================================================================
alter table public.tasks
  add column if not exists contatto_esterno_email text;

create table if not exists public.richieste_liberatoria (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks(id) on delete cascade,
  contatto_email   text not null,
  token            text not null unique default encode(gen_random_bytes(24), 'hex'),
  stato            text not null default 'inviata'
                   check (stato in ('inviata', 'caricata', 'scaduta')),
  version_id       uuid references public.deliverable_versions(id),
  creato_at        timestamptz not null default now(),
  scade_at         timestamptz,
  caricato_at      timestamptz
);

alter table public.richieste_liberatoria enable row level security;

drop policy if exists richieste_admin on public.richieste_liberatoria;
create policy richieste_admin on public.richieste_liberatoria
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists richieste_membro on public.richieste_liberatoria;
create policy richieste_membro on public.richieste_liberatoria
  for select to authenticated
  using (
    public.is_member_of(public.polo_of_task(task_id))
  );

grant select on public.richieste_liberatoria to authenticated;
grant insert, update, delete on public.richieste_liberatoria to authenticated;

create or replace function public.verifica_token_liberatoria(p_token text)
returns table (task_id uuid, contatto_email text)
language sql stable security definer set search_path = public as $$
  select rl.task_id, rl.contatto_email
  from public.richieste_liberatoria rl
  where rl.token = p_token
    and rl.stato = 'inviata'
    and (rl.scade_at is null or rl.scade_at > now());
$$;

grant execute on function public.verifica_token_liberatoria(text) to anon, authenticated;

create or replace function public.registra_upload_liberatoria(
  p_token    text,
  p_version  uuid
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.richieste_liberatoria
     set stato = 'caricata',
         version_id = p_version,
         caricato_at = now()
   where token = p_token and stato = 'inviata';

  if not found then
    raise exception 'Token non valido, gia usato o scaduto';
  end if;
end $$;

grant execute on function public.registra_upload_liberatoria(text, uuid) to anon;
