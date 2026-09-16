-- ============================================================================
-- 0134 — Il Collaboratore Tecnico vede e risponde alle domande tecniche
--
-- Con 0133 esiste il ruolo 'tecnico'. Questo file gli dà il suo UNICO
-- permesso: leggere e rispondere alle domande tecniche dei partecipanti
-- (public.domande_supporto con categoria_ia = 'tecnica'), così la risposta
-- arriva al partecipante senza passare dall'accesso globale.
--
-- Perimetro minimo (Documento 5, Art. 4 e 8.2):
--   • niente progetti, gruppi, polos, magazzino documenti, chat: il profilo del
--     Collaboratore Tecnico non ha nessuna appartenenza a un polo, quindi ogni
--     policy basata su is_admin/is_member_of/can_read_polo resta falsa;
--   • di chi chiede vede SOLO il nome di battesimo — mai cognome, email o
--     altri dati (funzione nome_battesimo qui sotto);
--   • può scrivere SOLO i campi della risposta: un trigger blocca ogni altra
--     modifica della riga (non può riscrivere la domanda né la categoria).
--
-- Eseguire con: npm run migra -- 0134   (dopo 0133).
-- ============================================================================

-- Chi è il Collaboratore Tecnico collegato a questa sessione.
create or replace function public.is_tecnico()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'tecnico' and p.attivo
  );
$$;

-- Nome di E BATTESIMO soltanto (Documento 5, Art. 8.2: a rispondere a una
-- domanda tecnica il cognome non serve mai). La restituisce solo a chi ha
-- titolo per vedere le domande tecniche: accesso globale e Collaboratore
-- Tecnico; per chiunque altro è null, così non diventa un modo per leggere
-- nomi altrui.
create or replace function public.nome_battesimo(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() or public.is_tecnico()
      then split_part(coalesce((select p.full_name from public.profiles p where p.id = p_user), ''), ' ', 1)
    else null
  end;
$$;

-- Lettura: solo le domande tecniche, niente altro.
drop policy if exists domande_supporto_tecnico_select on public.domande_supporto;
create policy domande_supporto_tecnico_select on public.domande_supporto
  for select to authenticated
  using (public.is_tecnico() and categoria_ia = 'tecnica');

-- Scrittura: il Collaboratore Tecnico risponde direttamente. La risposta
-- arriva subito al partecipante (che vede la propria riga con la policy
-- domande_supporto_proprie_select) senza passare dal Coordinatore.
drop policy if exists domande_supporto_tecnico_update on public.domande_supporto;
create policy domande_supporto_tecnico_update on public.domande_supporto
  for update to authenticated
  using (public.is_tecnico() and categoria_ia = 'tecnica')
  with check (public.is_tecnico() and categoria_ia = 'tecnica');

-- La policy UPDATE è per riga, non per colonna: senza questo trigger il
-- Collaboratore Tecnico potrebbe anche riscrivere la domanda o la categoria.
-- Il trigger ammette SOLO i tre campi della risposta, e solo quando la
-- modifica la fa lui (l'accesso globale resta libero).
create or replace function public.fn_domanda_tecnico_solo_risposta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_tecnico() and not public.is_admin() then
    if new.domanda is distinct from old.domanda
      or new.user_id is distinct from old.user_id
      or new.creato_at is distinct from old.creato_at
      or new.categoria_ia is distinct from old.categoria_ia
      or new.bozza_risposta_ia is distinct from old.bozza_risposta_ia
      or new.richiede_coordinatore is distinct from old.richiede_coordinatore
      or new.risposto_da is distinct from auth.uid() then
      raise exception 'Il Collaboratore Tecnico può scrivere solo la risposta.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_domanda_tecnico_solo_risposta on public.domande_supporto;
create trigger trg_domanda_tecnico_solo_risposta
  before update on public.domande_supporto
  for each row execute function public.fn_domanda_tecnico_solo_risposta();
