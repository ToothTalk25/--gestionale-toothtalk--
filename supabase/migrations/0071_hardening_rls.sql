-- =====================================================================
-- 0071_hardening_rls.sql — blindatura Zero Trust / Defense-in-Depth
-- =====================================================================
-- Obiettivo: riaffermare, in un'unica migrazione idempotente, i perni
-- della sicurezza dell'applicazione dopo l'audit:
--
--   1. RLS attiva su TUTTE le tabelle (nessuna tabella senza RLS);
--   2. revoke DELETE per il ruolo authenticated (la cancellazione resta
--      un'operazione amministrativa fuori dall'applicazione);
--   3. profili: un utente NON può modificare i propri campi sensibili
--      (role, attivo, email): solo l'Admin o il service_role;
--   4. vincolo di integrità: role in (member, admin).
--
-- Tutte le istruzioni sono idempotenti: possono essere rieseguite senza
-- effetti collaterali.
-- =====================================================================

-- --------------------------------------------------------------- 1. RLS
alter table public.audit_log            enable row level security;
alter table public.consensi             enable row level security;
alter table public.deliverable_versions enable row level security;
alter table public.deliverables         enable row level security;
alter table public.esportazioni_drive   enable row level security;
alter table public.formati              enable row level security;
alter table public.inviti               enable row level security;
alter table public.inviti_utilizzi      enable row level security;
alter table public.memberships          enable row level security;
alter table public.pacchetti_video      enable row level security;
alter table public.pacchetto_elementi   enable row level security;
alter table public.poli                 enable row level security;
alter table public.profiles             enable row level security;
alter table public.richieste_liberatoria enable row level security;
alter table public.richieste_modifica   enable row level security;
alter table public.task_status_history  enable row level security;
alter table public.tasks                enable row level security;
alter table public.verifiche_riconoscimento enable row level security;

-- ----------------------------------------------------- 2. revoke DELETE
-- Idempotente: già emesso in 0002, lo riaffermiamo per sicurezza.
revoke delete on all tables in schema public from authenticated;

-- ----------------------------------------------------- 3. trigger profili
-- Estende fn_protect_profile: un membro non può disattivarsi, non può
-- cambiare la propria email e non può promuoversi. Solo l'Admin o il
-- service_role possono toccare questi campi. Il cambio di role passa da
-- Admin o service_role (regola già esistente, riaffermata).
create or replace function public.fn_protect_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può modificare il ruolo di un utente' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'ID profilo non modificabile' using errcode = '42501';
  end if;
  if new.attivo is distinct from old.attivo and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Solo il Titolare può attivare/disattivare un profilo' using errcode = '42501';
  end if;
  if new.email is distinct from old.email and not (public.is_admin() or public.is_service_role()) then
    raise exception 'La email non è modificabile dal profilo' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile
  before update on public.profiles
  for each row execute function public.fn_protect_profile();

-- ----------------------------------------------------- 4. integrità role
do $$
begin
  alter table public.profiles drop constraint if exists chk_profiles_role;
end $$;

alter table public.profiles
  add constraint chk_profiles_role check (role in ('member', 'admin'));

-- ---------------------------------------------------------- commento
comment on table public.profiles is
  'Profili utente. RLS attiva; role/attivo/email modificabili solo da Admin o service_role.';
