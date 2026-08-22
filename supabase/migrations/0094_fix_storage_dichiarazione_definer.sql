-- =====================================================================
-- 0094_fix_storage_dichiarazione_definer.sql — rompe la ricorsione
--                                             della policy 0091
-- =====================================================================
-- 0091 ha introdotto storage_dichiarazione_riservata() come function
-- LANGUAGE sql STABLE SENZA SECURITY DEFINER. Quando la policy
-- originali_select (storage.objects) o versions_select
-- (deliverable_versions) la invoca, la sua query interna su
-- deliverable_versions subisce a sua volta la RLS versions_select, che
-- richiama di nuovo storage_dichiarazione_riservata()… e così via:
-- ricorsione infinita che Postgres interrompe con l'errore
-- "statement_too_complex" (SQLSTATE 54001). Effetto: ogni download di un
-- file del bucket originali da parte di un utente NON-admin (e ogni
-- lettura di deliverable_versions per i file originali) falliva con 54001,
-- sia per i file riservati sia per quelli condivisi col polo — il
-- comportamento di 0091 era di fatto bloccato per tutti i non-admin.
--
-- La correzione è la stessa usata dagli altri helper di policy
-- (polo_of_deliverable, polo_of_task, is_admin): rendere la function
-- SECURITY DEFINER così la sua lettura interna di coinvolge_terzi NON
-- passa dalla RLS di deliverable_versions e la catena si interrompe.
-- È corretto anche semanticamente: "questo file è riservato?" deve avere
-- UNA sola risposta indipendente da chi sta facendo la domanda.
-- =====================================================================

create or replace function public.storage_dichiarazione_riservata(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select t.coinvolge_terzi
        from public.deliverable_versions v
        join public.deliverables d on d.id = v.deliverable_id
        join public.tasks t on t.id = d.task_id
       where v.bucket = 'originali'
         and v.storage_path = p_name
         and d.kind in ('video_grezzo', 'audio')
       limit 1
    ),
    false
  );
$$;
