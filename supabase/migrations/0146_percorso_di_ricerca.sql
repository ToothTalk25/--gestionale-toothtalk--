-- =====================================================================
-- 0146_percorso_di_ricerca.sql — le funzioni si fidano solo di `public`
-- =====================================================================
-- Perché. Una funzione PostgreSQL che non dichiara il proprio "percorso di
-- ricerca" (`search_path`) cerca i nomi che usa — tabelle, altre funzioni,
-- operatori — dove capita: nel percorso dell'utente che la sta chiamando.
-- Se dentro c'è uno schema che l'utente può scrivere, può metterci dentro un
-- `decidi_se_admin()` o una tabella con lo stesso nome, e la funzione (che per
-- le funzioni SECURITY DEFINER gira con i diritti del proprietario) chiamerà
-- quella. È il modo classico di far salire di privilegio una funzione.
--
-- Nel progetto la stragrande maggioranza delle funzioni dichiara già
-- `set search_path = public` fin dalla 0001: questa migrazione allinea le venti
-- che erano rimaste indietro (segnalate dal controllo di Supabase, che per
-- questo non guarda se sono innocue: guarda se dichiarano il percorso).
--
-- Perché è sicuro: le uniche cose che queste funzioni usano fuori da `public`
-- le citano per esteso (`extensions.digest` in audit_row_payload, `auth.uid()`
-- ovunque): i nomi qualificati non hanno bisogno del percorso — è proprio il
-- motivo per cui si scrivono per esteso. Verificato funzione per funzione
-- leggendo i corpi generati dal database prima di scrivere questa migrazione.
--
-- `pg_temp` NON entra nel percorso: lo schema temporaneo è dello chiamante, e
-- lasciarglielo cercare sarebbe come lasciare la porta aperta mentre si chiude
-- la finestra.
-- =====================================================================

alter function public.audit_row_payload(bigint, timestamp with time zone, uuid, user_role, text, text, uuid, uuid, jsonb, text) set search_path = public;
alter function public.can_read_polo(uuid) set search_path = public;
alter function public.fn_audit_append_only() set search_path = public;
alter function public.fn_eliminazione_grezzo_guard() set search_path = public;
alter function public.fn_notifiche82_guard() set search_path = public;
alter function public.fn_pacchetto_no_delete() set search_path = public;
alter function public.fn_ricar_dich_guard() set search_path = public;
alter function public.fn_richiesta_guard() set search_path = public;
alter function public.fn_rimozione_guard() set search_path = public;
alter function public.fn_touch_updated_at() set search_path = public;
alter function public.fn_versions_append_only() set search_path = public;
alter function public.is_service_role() set search_path = public;
alter function public.pec_universitaria_valida(uuid, text) set search_path = public;
alter function public.storage_path_magazzino_valido(text) set search_path = public;
alter function public.storage_path_valido(text) set search_path = public;
alter function public.storage_polo_id(text) set search_path = public;
alter function public.storage_profilo_tipo(text) set search_path = public;
alter function public.storage_profilo_uid(text) set search_path = public;
alter function public.storage_task_id(text) set search_path = public;
alter function public.try_uuid(text) set search_path = public;

-- Controllo: nessuna delle venti deve restare senza percorso fissato. Se una
-- non esistesse (per esempio dopo una rinomina), questa migrazione lo direbbe
-- invece di fallire in silenzio — `alter function` su una funzione inesistente
-- è già un errore, e questo controllo copre il caso opposto: che sia rimasta
-- senza.
do $$
declare
  senza text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into senza
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (
       'audit_row_payload', 'can_read_polo', 'fn_audit_append_only',
       'fn_eliminazione_grezzo_guard', 'fn_notifiche82_guard', 'fn_pacchetto_no_delete',
       'fn_ricar_dich_guard', 'fn_richiesta_guard', 'fn_rimozione_guard',
       'fn_touch_updated_at', 'fn_versions_append_only', 'is_service_role',
       'pec_universitaria_valida', 'storage_path_magazzino_valido', 'storage_path_valido',
       'storage_polo_id', 'storage_profilo_tipo', 'storage_profilo_uid',
       'storage_task_id', 'try_uuid'
     )
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%'
     );

  if senza is not null then
    raise exception 'Ancora senza percorso di ricerca fissato: %', senza;
  end if;
  raise notice 'Tutte le venti funzioni hanno il percorso di ricerca fissato.';
end;
$$;
