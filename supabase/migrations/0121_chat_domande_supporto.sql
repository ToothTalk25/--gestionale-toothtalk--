-- =====================================================================
-- 0121_chat_domande_supporto.sql — widget chat: escalation esplicita
-- =====================================================================
-- La sezione "Domande" diventa un widget chat: l'IA risponde in automatico
-- alle domande tecniche (bozza_risposta_ia, esistente da 0120, ora mostrata
-- subito al collaboratore invece di restare in attesa di approvazione), ma
-- il collaboratore può sempre chiedere di parlare col Coordinatore anche
-- dopo una risposta IA. richiede_coordinatore è l'unico campo che un
-- collaboratore può cambiare su una propria domanda dopo averla creata —
-- per questo passa da una funzione SECURITY DEFINER dedicata (RLS da sola
-- non isola bene un singolo campo) invece che da una policy UPDATE larga.

alter table public.domande_supporto
  add column if not exists richiede_coordinatore boolean not null default false;

create or replace function public.richiedi_coordinatore_domanda(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.domande_supporto
     set richiede_coordinatore = true
   where id = p_id and user_id = auth.uid();

  if not found then
    raise exception 'Domanda non trovata o non tua.';
  end if;
end $$;

grant execute on function public.richiedi_coordinatore_domanda(uuid) to authenticated;
