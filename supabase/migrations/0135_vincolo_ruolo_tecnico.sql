-- ============================================================================
-- 0135 — Il vincolo sul ruolo deve conoscere 'tecnico'
--
-- 0133 ha allargato il tipo enum user_role con il valore 'tecnico', ma il
-- profilo aveva ancora il vincolo di 0071 che elencava solo member/admin:
-- senza questo file la creazione dell'accesso del Collaboratore Tecnico
-- fallisce con «violates check constraint chk_profiles_role».
--
-- Eseguire con: npm run migra -- 0135   (dopo 0133 e 0134).
-- ============================================================================

alter table public.profiles drop constraint if exists chk_profiles_role;
alter table public.profiles
  add constraint chk_profiles_role check (role in ('member', 'admin', 'tecnico'));
