-- =====================================================================
-- 0022_codici_invito.sql — ingresso solo su invito, con assegnazione
--                          automatica al gruppo
-- =====================================================================
-- Prima di questa migrazione chiunque poteva creare un account: restava
-- senza gruppo e non vedeva nulla, ma occupava comunque un posto e la
-- porta era aperta.
--
-- Adesso per registrarsi serve il codice del proprio gruppo. Il codice
-- NON è personale: è del gruppo, si distribuisce una volta e vale per
-- tutti quelli che devono entrare lì. Chi lo usa viene assegnato
-- automaticamente al gruppo corrispondente.
--
-- Il codice viene verificato SOLO lato server, dentro una funzione
-- SECURITY DEFINER: dal browser non è possibile né leggerlo né aggirarlo.
-- =====================================================================

create table if not exists public.inviti (
  id          uuid primary key default gen_random_uuid(),
  codice      text not null unique,
  polo_id     uuid not null references public.poli(id) on delete cascade,
  attivo      boolean not null default true,
  max_usi     int,                       -- null = nessun limite
  usi         int not null default 0,
  scade_il    timestamptz,               -- null = nessuna scadenza
  creato_da   uuid references public.profiles(id),
  creato_at   timestamptz not null default now(),
  note        text
);

create index if not exists idx_inviti_polo on public.inviti(polo_id);

comment on table public.inviti is
  'Codici di ingresso, uno per gruppo universitario. Non sono personali: '
  'si distribuiscono al gruppo e chi li usa viene assegnato a quel gruppo.';

-- Chi è entrato con quale codice: serve ad accorgersi subito se un codice
-- è circolato fuori dal gruppo.
create table if not exists public.inviti_utilizzi (
  id         uuid primary key default gen_random_uuid(),
  invito_id  uuid not null references public.inviti(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  email      text not null,
  usato_at   timestamptz not null default now()
);

create index if not exists idx_utilizzi_invito on public.inviti_utilizzi(invito_id);

-- ---------------------------------------------------------------- codici

/**
 * Genera un codice leggibile del tipo MESSINA-4K7X.
 * Niente 0/O/1/I/L: si confondono quando qualcuno lo detta a voce.
 */
create or replace function public.genera_codice_invito(p_polo uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_slug  text;
  v_suff  text;
  v_alfa  text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_cod   text;
  i       int;
begin
  select upper(regexp_replace(slug, '[^a-z0-9]', '', 'g')) into v_slug
  from public.poli where id = p_polo;

  if v_slug is null then
    raise exception 'Gruppo inesistente';
  end if;

  loop
    v_suff := '';
    for i in 1..4 loop
      v_suff := v_suff || substr(v_alfa, 1 + floor(random() * length(v_alfa))::int, 1);
    end loop;
    v_cod := v_slug || '-' || v_suff;
    exit when not exists (select 1 from public.inviti where codice = v_cod);
  end loop;

  return v_cod;
end $$;

/** Crea (o rigenera) il codice di un gruppo. Il precedente viene disattivato. */
create or replace function public.crea_invito(
  p_polo    uuid,
  p_max_usi int default null,
  p_scade_il timestamptz default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare v_cod text;
begin
  if not public.is_admin() then
    raise exception 'Operazione non disponibile da qui' using errcode = '42501';
  end if;

  -- Un solo codice vivo per gruppo: rigenerare significa invalidare il vecchio.
  update public.inviti set attivo = false where polo_id = p_polo and attivo;

  v_cod := public.genera_codice_invito(p_polo);

  insert into public.inviti (codice, polo_id, max_usi, scade_il, creato_da)
  values (v_cod, p_polo, p_max_usi, p_scade_il, auth.uid());

  insert into public.audit_log (actor, actor_role, action, entity_type, polo_id, meta)
  values (auth.uid(), 'admin', 'creazione_codice_invito', 'invito', p_polo,
          jsonb_build_object('max_usi', p_max_usi, 'scade_il', p_scade_il));

  return v_cod;
end $$;

/**
 * Verifica un codice e restituisce il gruppo, senza consumarlo.
 *
 * Serve alla pagina di registrazione per dire "codice valido, gruppo
 * Messina" prima ancora di creare l'account. Non espone nulla di
 * sensibile: solo il nome del gruppo, e solo se il codice è giusto.
 */
create or replace function public.verifica_invito(p_codice text)
returns table (valido boolean, motivo text, polo_id uuid, polo_nome text)
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select i.*, p.nome as nome_polo into v
  from public.inviti i
  join public.poli p on p.id = i.polo_id
  where upper(btrim(i.codice)) = upper(btrim(p_codice));

  if not found then
    return query select false, 'Codice non riconosciuto'::text, null::uuid, null::text;
    return;
  end if;

  if not v.attivo then
    return query select false, 'Codice non più valido'::text, null::uuid, null::text;
    return;
  end if;

  if v.scade_il is not null and v.scade_il < now() then
    return query select false, 'Codice scaduto'::text, null::uuid, null::text;
    return;
  end if;

  if v.max_usi is not null and v.usi >= v.max_usi then
    return query select false, 'Codice esaurito'::text, null::uuid, null::text;
    return;
  end if;

  return query select true, null::text, v.polo_id, v.nome_polo;
end $$;

/**
 * Consuma il codice e assegna l'utente al gruppo.
 *
 * Chiamata dal server DOPO la creazione dell'account. Il blocco `for
 * update` impedisce che due registrazioni simultanee sforino il numero
 * massimo di usi.
 */
create or replace function public.consuma_invito(p_codice text, p_user uuid, p_email text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.inviti
  where upper(btrim(codice)) = upper(btrim(p_codice))
  for update;

  if not found or not v.attivo then
    raise exception 'Codice non valido';
  end if;
  if v.scade_il is not null and v.scade_il < now() then
    raise exception 'Codice scaduto';
  end if;
  if v.max_usi is not null and v.usi >= v.max_usi then
    raise exception 'Codice esaurito';
  end if;

  insert into public.memberships (user_id, polo_id)
  values (p_user, v.polo_id)
  on conflict do nothing;

  update public.inviti set usi = usi + 1 where id = v.id;

  insert into public.inviti_utilizzi (invito_id, user_id, email)
  values (v.id, p_user, p_email);

  insert into public.audit_log (actor, actor_role, action, entity_type, entity_id, polo_id, meta)
  values (p_user, 'member', 'ingresso_con_invito', 'invito', v.id, v.polo_id,
          jsonb_build_object('email', p_email, 'codice', v.codice));

  return v.polo_id;
end $$;

-- ----------------------------------------------------------------- RLS

alter table public.inviti           enable row level security;
alter table public.inviti_utilizzi  enable row level security;

-- I codici li vede e li gestisce solo chi ha accesso globale. Chi si
-- registra non legge mai questa tabella: passa dalle funzioni qui sopra.
drop policy if exists inviti_admin on public.inviti;
create policy inviti_admin on public.inviti
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists utilizzi_admin on public.inviti_utilizzi;
create policy utilizzi_admin on public.inviti_utilizzi
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.inviti to authenticated;
grant select, insert on public.inviti_utilizzi to authenticated;

-- verifica_invito è l'unica chiamabile da chi non è ancora autenticato:
-- serve alla pagina di registrazione per confermare il gruppo.
grant execute on function public.verifica_invito(text) to anon, authenticated;
grant execute on function public.crea_invito(uuid, int, timestamptz) to authenticated;

-- consuma_invito assegna un utente a un gruppo: la chiama solo il server
-- con la chiave di servizio, dopo aver creato davvero l'account.
revoke execute on function public.consuma_invito(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.consuma_invito(text, uuid, text) to service_role;

revoke execute on function public.genera_codice_invito(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- vista
create or replace view public.v_inviti
with (security_invoker = true) as
select
  i.id,
  i.codice,
  i.polo_id,
  p.nome as gruppo,
  i.attivo,
  i.usi,
  i.max_usi,
  i.scade_il,
  i.creato_at,
  (
    i.attivo
    and (i.scade_il is null or i.scade_il > now())
    and (i.max_usi is null or i.usi < i.max_usi)
  ) as utilizzabile
from public.inviti i
join public.poli p on p.id = i.polo_id;

grant select on public.v_inviti to authenticated;
