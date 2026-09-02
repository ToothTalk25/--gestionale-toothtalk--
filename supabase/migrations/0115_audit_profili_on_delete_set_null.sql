-- =====================================================================
-- 0115_audit_profili_on_delete_set_null.sql — account eliminabili senza
--                                         orfani, audit scrivibile solo dal server
-- =====================================================================
-- Due obiettivi, emersi dall'audit di sicurezza:
--
-- 1. RENDERE ELIMINABILI GLI ACCOUNT (test, errori di creazione) senza
--    rompere l'append-only. Oggi audit_log.actor e i campi "approvato_da"
--    su profiles hanno FK senza ON DELETE: chi ha una qualunque riga di
--    audit (o ha approvato qualcosa) non è eliminabile. Con ON DELETE
--    SET NULL la riga di audit RESTA (l'append-only non si tocca), solo
--    l'attore diventa null — la stessa convenzione già usata per le
--    scritture dirette al DB (auth.uid() = null). L'eliminazione di un
--    profilo avviene SOLO via admin/service_role (mai dal client).
--
-- 2. CHIUDERE L'INSERT DI AUDIT AGLI UTENTI. La policy audit_insert
--    (actor = auth.uid()) permetteva a qualunque autenticato di scrivere
--    righe di audit attribuite a sé stesso: non è un privilegio, ma
--    sporca il registro (append-only, quindi per sempre). L'audit è un
--    registro probatorio: lo scrive solo il server (service_role). Le
--    server action che ancora inserivano con la sessione utente vengono
--    portate a supabaseAdmin() in parallelo (vedi actions*.ts). I
--    trigger SECURITY DEFINER che tracciano i cambi (es. cambio ruolo)
--    non sono toccati: girano come proprietario del database, RLS non li
--    blocca.
-- =====================================================================

-- Audit: la riga resta, l'attore viene anonimizzato quando l'account
-- sparisce (coerente con l'attore null delle scritture dirette).
alter table public.audit_log
  drop constraint if exists audit_log_actor_fkey,
  add constraint audit_log_actor_fkey
    foreign key (actor) references public.profiles(id) on delete set null;

-- Chi ha approvato registrazioni/accordi/rinnovi: alla sua eliminazione il
-- riferimento diventa null (il "quando" resta nei timestamp della riga).
alter table public.profiles
  drop constraint if exists profiles_approvato_da_fkey,
  add constraint profiles_approvato_da_fkey
    foreign key (approvato_da) references public.profiles(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_accordo_approvato_da_fkey,
  add constraint profiles_accordo_approvato_da_fkey
    foreign key (accordo_approvato_da) references public.profiles(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_rinnovo_approvato_da_fkey,
  add constraint profiles_rinnovo_approvato_da_fkey
    foreign key (rinnovo_approvato_da) references public.profiles(id) on delete set null;

-- Audit scrivibile SOLO dal server: senza questa policy, gli insert via
-- client autenticato vengono respinti (nessuna policy = divieto totale).
drop policy if exists audit_insert on public.audit_log;
