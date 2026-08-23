-- =====================================================================
-- 0105_cancellazione_copie_art94.sql — conferma Art. 9.4 Accordo Editoriale
-- =====================================================================
-- Art. 9.4: alla cessazione, il Collaboratore cancella ogni copia locale dei
-- materiali grezzi, dei recapiti e degli altri dati personali di terzi entro
-- 48 ore, "dandone comunicazione al Coordinatore". Il gestionale traccia la
-- richiesta di conferma (scattata alla chiusura della collaborazione) e la
-- conferma digitale del Collaboratore (flusso "conferma uscita").
-- Un'unica conferma puntuale per persona: due campi su profiles, nessuna
-- tabella dedicata (a differenza di notifiche_dovute_art82, qui non c'è una
-- coda di richieste da gestire).
alter table public.profiles
  add column if not exists cancellazione_copie_richiesta_at timestamptz,
  add column if not exists cancellazione_copie_confermata_at timestamptz;

comment on column public.profiles.cancellazione_copie_richiesta_at is
  'Chiusura collaborazione: da qui decorrono le 48 ore per la conferma di cancellazione delle copie locali (Art. 9.4 Accordo Editoriale).';
comment on column public.profiles.cancellazione_copie_confermata_at is
  'Data della conferma del Collaboratore di aver cancellato le copie locali (Art. 9.4). NULL = conferma non ancora ricevuta.';
