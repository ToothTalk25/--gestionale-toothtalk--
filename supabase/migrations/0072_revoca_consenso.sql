-- =====================================================================
-- 0072_revoca_consenso.sql — revoca consenso GDPR (append-only)
-- =====================================================================
-- Il GDPR richiede che la revoca sia "facile come il consenso" e che
-- entrambi siano dimostrabili. Qui la revoca viene registrata sulle righe
-- di consenso esistenti (mai cancellate): restano chi, quando, quale
-- versione, e quando/quando-da è stata revocata.
--
-- La revoca è per il futuro: non cancella i dati già trattati né tocca
-- le liberatorie (che sono prova legale, Art. 17(3)(e) GDPR).
-- =====================================================================

alter table public.consensi
  add column if not exists revocato_at timestamptz,
  add column if not exists revocato_da  uuid references public.profiles(id);

comment on column public.consensi.revocato_at is
  'Quando il consenso è stato revocato (null = ancora valido). Le righe non si cancellano mai.';
comment on column public.consensi.revocato_da is
  'Chi ha revocato (auth.uid() al momento della revoca).';

-- Un consenso è "attivo" se la riga più recente per (user, tipo) non è
-- revocata e corrisponde alla versione corrente. Le revoche successive
-- vanno a marcare le righe attive, non a cancellarle.
create or replace function public.revoca_consenso(p_tipo text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_tipo not in ('privacy', 'cookie', 'riconoscimento_foto') then
    return false;
  end if;
  -- Marca come revocate tutte le righe attive (non revocate) di quel tipo.
  -- Append-only: nessuna DELETE, la storia resta.
  update public.consensi
     set revocato_at = now(),
         revocato_da = v_uid
   where user_id = v_uid
     and tipo = p_tipo
     and revocato_at is null;
  return true;
end $$;

revoke all on function public.revoca_consenso(text) from public;
grant execute on function public.revoca_consenso(text) to authenticated;

-- Per comodità del banner: l'ultimo consenso di un tipo è attivo se
-- esiste una riga non revocata per la versione corrente.
create or replace function public.consenso_attivo(p_user uuid, p_tipo text, p_versione text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.consensi c
    where c.user_id = p_user
      and c.tipo = p_tipo
      and c.versione = p_versione
      and c.revocato_at is null
  );
$$;

revoke all on function public.consenso_attivo(uuid, text, text) from public;
grant execute on function public.consenso_attivo(uuid, text, text) to authenticated;
