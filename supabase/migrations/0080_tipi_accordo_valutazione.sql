-- =====================================================================
-- 0080_tipi_accordo_valutazione.sql — accordi Front Man / Backstage
-- =====================================================================
-- Distingue i due accordi editoriali (chi appare in video vs chi sta
-- dietro le quinte) e aggiunge il flusso di valutazione del Titolare:
-- se l'IA rileva un'incongruenza tra l'accordo caricato e il tipo di
-- partecipante, il documento entra in "in_attesa" finché l'Admin non si
-- esprime (approvato/respinto). Solo il Titolare può sbloccare il caso.
-- =====================================================================

-- 1. Estende il check su consents_and_releases.tipo: ora il sistema
--    distingue i due accordi dai tipi esistenti.
alter table public.consents_and_releases
  drop constraint if exists consents_and_releases_tipo_check;

alter table public.consents_and_releases
  add constraint consents_and_releases_tipo_check
  check (tipo in (
    'accordo_front_man',   -- accordo per chi appare in video (on_screen=true)
    'accordo_backstage',   -- accordo per chi non appare (on_screen=false)
    'liberatoria',         -- soggetti esterni intervistati (firma OTP)
    'nda'                  -- professionisti/consulenti
  ));

comment on column public.consents_and_releases.tipo is
  'Tipo di documento: accordo_front_man (chi appare), accordo_backstage (chi '
  'non appare), liberatoria (soggetti esterni via OTP), nda (professionisti).';

-- 2. Valutazione del Titolare per gli accordi segnalati come incongruenti.
alter table public.consents_and_releases
  add column if not exists valutazione_admin text
  check (valutazione_admin in ('in_attesa', 'approvato', 'respinto'));

alter table public.consents_and_releases
  add column if not exists valutato_da uuid references public.profiles(id);

alter table public.consents_and_releases
  add column if not exists valutato_at timestamptz;

comment on column public.consents_and_releases.valutazione_admin is
  'Esito della valutazione del Titolare per un accordo segnalato come '
  'incongruente dall''IA. null = nessuna segnalazione. in_attesa = il '
  'documento non è valido finché il Titolare non decide. Solo l''Admin può '
  'passare da in_attesa ad approvato/respinto.';
