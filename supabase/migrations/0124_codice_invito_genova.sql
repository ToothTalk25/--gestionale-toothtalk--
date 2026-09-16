-- =====================================================================
-- 0124_codice_invito_genova.sql — codice d invito per il gruppo Genova
-- =====================================================================
-- La funzione crea_invito pretende la sessione dell accesso globale
-- (controlla is_admin()), quindi non è richiamabile da uno script con la
-- chiave di servizio: qui si riproduce esattamente quello che fa quella
-- funzione — un solo codice vivo per gruppo, stesso formato del codice,
-- stessa riga di audit — firmandola con il profilo dell accesso globale.
--
-- Messina: il suo codice è stato disattivato a mano (non serve più: il
-- gruppo è chiuso).
-- =====================================================================

do $$
declare
  v_polo  uuid;
  v_admin uuid;
  v_cod   text;
begin
  select id into v_polo from public.poli where slug = 'genova';
  select id into v_admin from public.profiles where email = 'enricoguarino25@gmail.com';

  if v_polo is null then
    raise exception 'Gruppo Genova non trovato';
  end if;

  update public.inviti set attivo = false where polo_id = v_polo and attivo;

  v_cod := public.genera_codice_invito(v_polo);

  insert into public.inviti (codice, polo_id, max_usi, scade_il, creato_da)
  values (v_cod, v_polo, null, null, v_admin);

  insert into public.audit_log (actor, actor_role, action, entity_type, polo_id, meta)
  values (v_admin, 'admin', 'creazione_codice_invito', 'invito', v_polo,
          jsonb_build_object('origine', 'migrazione 0124'));
end $$;
