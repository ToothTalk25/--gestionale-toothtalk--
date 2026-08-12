-- =====================================================================
-- 0055_titolo_youtube_kind.sql — nuovo kind per i titoli YouTube Shorts
-- =====================================================================
-- Sdoppia la card "Descrizione e titoli YouTube" in due card distinte,
-- ciascuna col proprio Google Doc collegabile.
-- =====================================================================

alter type deliverable_kind add value if not exists 'titolo_youtube';
