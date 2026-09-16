-- =====================================================================
-- 0132_collaboratore_tecnico_accordo_path.sql — impronta del Documento 5
-- calcolata dal server su un file reale, non digitata a mano.
-- =====================================================================
-- accordo_sha256 come solo campo di testo non serviva a nulla: nessun
-- file da cui è stato calcolato, quindi nessuna verifica possibile in un
-- secondo momento. accordo_path aggancia l'impronta a una scansione
-- reale in storage (bucket "finali", stesso principio di
-- caricaAccordo/caricaControfirmaAccordo): il campo di testo resta solo
-- come valore provvisorio per chi non ha ancora caricato la scansione.
-- =====================================================================

alter table public.collaboratori_tecnici
  add column if not exists accordo_path text;

comment on column public.collaboratori_tecnici.accordo_path is
  'Percorso in storage (bucket finali) della scansione firmata del '
  'Documento 5: se presente, accordo_sha256 è stato ricalcolato dal '
  'server su questo file, non digitato a mano.';
