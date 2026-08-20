-- =====================================================================
-- 0082_modello_accordo.sql — modello dell'accordo editoriale (unico)
-- =====================================================================
-- Il documento che viene inviato ai collaboratori per la firma: UNO SOLO
-- per tutti (on-screen o backstage), perché la cessione dei diritti di
-- immagine e autore è già dentro l'unico documento.
--
-- Ogni caricamento dell'admin è una NUOVA riga (append-only in pratica:
-- resta lo storico di chi ha aggiornato il modello e quando). Il modello
-- attivo è l'ULTIMA riga (order by caricato_at desc limit 1). Nessun
-- campo "tipo", nessun enum: è un documento amministrativo, non
-- probatorio, quindi non serve irrigidirlo quanto deliverable_versions.
-- =====================================================================

create table if not exists public.modello_accordo (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null,
  sha256        text not null,
  caricato_at   timestamptz not null default now(),
  caricato_da   uuid references public.profiles(id)
);

comment on table public.modello_accordo is
  'Modello dell''accordo editoriale inviato ai collaboratori. Ogni riga è '
  'un caricamento dell''admin; il modello attivo è l''ultima riga. Unico '
  'per tutti i collaboratori: nessuna distinzione on-screen/backstage.';

alter table public.modello_accordo enable row level security;

-- Solo l'admin (Titolare) può leggere e caricare il modello.
drop policy if exists modello_accordo_admin on public.modello_accordo;
create policy modello_accordo_admin on public.modello_accordo
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Il file vive nel bucket "finali" (archivio), come gli altri materiali
-- certificati del progetto.
