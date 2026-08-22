-- =====================================================================
-- 0100_revoca_video_on_screen_drop_old.sql — rimuove il vecchio overload
-- =====================================================================
-- 0098 ha aggiunto revoca_video_on_screen(uuid[]) (selezione esplicita dei
-- file, admin-only). Il vecchio overload revoca_video_on_screen(uuid),
-- che cancellava per uploaded_by (il difetto alla base del redesign), non è
-- più chiamato da nessun codice ma resta in schema: meglio rimuoverlo per
-- non lasciare in giro una funzione col comportamento sbagliato.
-- =====================================================================

drop function if exists public.revoca_video_on_screen(uuid);
