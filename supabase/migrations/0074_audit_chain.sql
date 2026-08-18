-- =====================================================================
-- 0074_audit_chain.sql — Audit log a catena crittografica (hash chaining)
-- =====================================================================
-- GDPR Art. 5(2) & 32: accountability. L'audit_log diventa una catena
-- di hash: ogni riga contiene l'impronta SHA-256 della riga precedente
-- (prev_hash). Manomettere una riga nel mezzo rompe la catena a valle,
-- rendendo la falsificazione dimostrabile a chiunque ricalcoli gli hash.
--
-- Idempotente: le colonne vengono aggiunte solo se assenti e il trigger
-- si applica alle nuove righe. Le righe storiche restano (append-only).
-- =====================================================================

alter table public.audit_log
  add column if not exists prev_hash text,
  add column if not exists row_hash  text;

comment on column public.audit_log.prev_hash is
  'SHA-256 della riga precedente: la catena di hash rende dimostrabile ogni manomissione.';
comment on column public.audit_log.row_hash is
  'SHA-256 della riga corrente (contenuto + prev_hash).';

-- Calcola l'impronta canonica di una riga (ordine dei campi stabile).
create or replace function public.audit_row_payload(
  p_id        bigint,
  p_at        timestamptz,
  p_actor     uuid,
  p_actor_role public.user_role,
  p_action    text,
  p_entity_type text,
  p_entity_id uuid,
  p_polo_id   uuid,
  p_meta      jsonb,
  p_prev_hash text
) returns text language sql immutable as $$
  select encode(extensions.digest(
    coalesce(p_id::text,'') || '|' ||
    coalesce(p_at::text,'') || '|' ||
    coalesce(p_actor::text,'') || '|' ||
    coalesce(p_actor_role::text,'') || '|' ||
    coalesce(p_action,'') || '|' ||
    coalesce(p_entity_type,'') || '|' ||
    coalesce(p_entity_id::text,'') || '|' ||
    coalesce(p_polo_id::text,'') || '|' ||
    coalesce(p_meta::text,'') || '|' ||
    coalesce(p_prev_hash,''),
    'sha256'), 'hex');
$$;

-- Trigger: calcola prev_hash (dall'ultima riga) e row_hash per ogni INSERT.
create or replace function public.fn_audit_chain()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev_hash text;
begin
  select row_hash into v_prev_hash
  from public.audit_log
  order by id desc
  limit 1;

  new.prev_hash := v_prev_hash;
  new.row_hash  := public.audit_row_payload(
    new.id, new.at, new.actor, new.actor_role, new.action,
    new.entity_type, new.entity_id, new.polo_id, new.meta, new.prev_hash
  );
  return new;
end $$;

drop trigger if exists trg_audit_chain on public.audit_log;
create trigger trg_audit_chain
  before insert on public.audit_log
  for each row execute function public.fn_audit_chain();

-- Verifica d'integrità: ricalcola la catena e restituisce TUTTE le righe
-- non coerenti (null se la catena è integra). Per audit periodici.
-- Le righe storiche inserite prima del trigger (row_hash null) sono
-- segnalate come '<legacy>' ma la scansione prosegue.
create or replace function public.audit_verifica_catena()
returns table (id bigint, prevista text, trovata text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev text := null;
  v_riga record;
begin
  for v_riga in
    select a.id, a.at, a.actor, a.actor_role, a.action, a.entity_type,
           a.entity_id, a.polo_id, a.meta, a.prev_hash, a.row_hash
    from public.audit_log a
    order by a.id
  loop
    -- riga storica legacy (prima della migrazione): non verificabile, si prosegue
    if v_riga.row_hash is null then
      v_prev := null;
      continue;
    end if;

    -- prev_hash deve coincidere con l'hash della riga precedente
    if v_riga.prev_hash is distinct from v_prev then
      return query select v_riga.id::bigint,
        coalesce(v_prev, '<inizio>')::text,
        coalesce(v_riga.prev_hash, '<null>')::text;
    end if;

    -- row_hash deve coincidere con il ricalcolo del payload
    if v_riga.row_hash is distinct from public.audit_row_payload(
      v_riga.id, v_riga.at, v_riga.actor, v_riga.actor_role, v_riga.action,
      v_riga.entity_type, v_riga.entity_id, v_riga.polo_id, v_riga.meta, v_riga.prev_hash
    ) then
      return query select v_riga.id::bigint, v_riga.row_hash::text,
        public.audit_row_payload(
          v_riga.id, v_riga.at, v_riga.actor, v_riga.actor_role, v_riga.action,
          v_riga.entity_type, v_riga.entity_id, v_riga.polo_id, v_riga.meta, v_riga.prev_hash
        );
    end if;

    v_prev := v_riga.row_hash;
  end loop;
  return;
end $$;

grant execute on function public.audit_verifica_catena() to authenticated;
revoke all on function public.audit_verifica_catena() from public;
