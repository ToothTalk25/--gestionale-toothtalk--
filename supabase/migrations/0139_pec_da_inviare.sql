-- =====================================================================
-- 0139_pec_da_inviare.sql — la PEC esce dal computer, non dalla piattaforma
-- =====================================================================
-- Perché. Dal 15 settembre 2026 la casella toothtalk@pec.it (Aruba) rifiuta
-- gli invii automatici del gestionale:
--
--   554 5.7.1 Indirizzo IP bloccato temporaneamente per sospetto abuso
--
-- La causa non è un difetto dell'applicazione: la PEC partiva da Vercel, che
-- non ha regioni italiane e usa un pool di indirizzi esteri, diversi a ogni
-- invio. Per un gestore PEC quella è la firma di una casella compromessa, e
-- nel ticket 19039798A hanno risposto che per gli IP esteri (e per un numero
-- elevato di IP usati dallo stesso cloud) l'unico rimedio che possono offrire
-- è "aprire la casella a tutti gli IP" — cioè rinunciare alla protezione
-- anti-abuso su una casella che firma documenti con valore legale. Hanno
-- anche scritto che gli IP italiani, anche dinamici, non vengono bloccati.
--
-- Quindi il punto di invio si sposta, come per la copia su Drive (0033): chi
-- deve ricevere una PEC finisce in questa coda, e un comando eseguito su una
-- postazione italiana (scripts/invia-pec.mjs, `npm run pec -- --esegui`) la
-- spedisce davvero. La piattaforma prepara e racconta lo stato; il tratto che
-- non può fare da lì lo fa il computer.
--
-- Conseguenza voluta: la password della PEC non serve più all'applicazione.
-- Resta solo sulla postazione che spedisce (e, finché il verbale dei
-- pacchetti sigillati passa di qui, anche fra le variabili di Vercel).
-- =====================================================================

-- -------------------------------------------------------------- la coda
create table if not exists public.pec_da_inviare (
  id                uuid primary key default gen_random_uuid(),
  creato_at         timestamptz not null default now(),
  aggiornato_at     timestamptz not null default now(),
  -- 'in_coda' → 'inviata' (oppure 'errore', con il motivo in ultimo_errore;
  -- 'annullata' per una PEC che non va più spedita: la riga resta come traccia).
  stato             text not null default 'in_coda'
                    check (stato in ('in_coda', 'inviata', 'errore', 'annullata')),
  oggetto           text not null,
  testo             text not null,
  html              text,
  -- "to" (le persone) e "cc" restano due colonne separate perché nella PEC la
  -- differenza è giuridica, non di forma: il verbale attesta la consegna ai
  -- destinatari principali.
  destinatari       text[] not null,
  copia_conoscenza  text[],
  -- I file viaggiano come RIFERIMENTI, non come byte: un messaggio con gli
  -- allegati può pesare decine di MB e la coda non è un archivio.
  allegati          jsonb not null default '[]'::jsonb,
  -- Che cos'altro deve succedere quando la PEC parte davvero: lo stato che
  -- l'applicazione non può conoscere in anticipo, perché la spedizione non è
  -- più sua. Senza questo, l'app mostrerebbe come fatto qualcosa che non è
  -- ancora avvenuto.
  contesto          jsonb not null default '{}'::jsonb,
  tentativi         integer not null default 0,
  ultimo_errore     text,
  message_id        text,
  inviata_at        timestamptz
);

comment on table public.pec_da_inviare is
  'PEC preparate dal gestionale e ancora da spedire: le spedisce '
  'scripts/invia-pec.mjs da una postazione italiana (Aruba blocca gli invii '
  'automatici da indirizzi esteri e da troppi indirizzi diversi — ticket '
  '19039798A). Una riga per messaggio, con l''esito: in_coda → inviata.';

comment on column public.pec_da_inviare.allegati is
  'Riferimenti agli allegati, non i byte: {nome, bucket, percorso, sha256} per '
  'i file nello storage, {nome, file_pubblico, sha256} per i documenti del '
  'progetto (public/documenti/), {nome, testo} per gli allegati generati '
  '(manifesto, note). Lo script verifica ogni impronta PRIMA di spedire: se un '
  'file è cambiato dopo l''accodamento, la PEC non parte e la riga va in '
  'errore — meglio non certificare niente che certificare un file diverso da '
  'quello che si è deciso di certificare.';

comment on column public.pec_da_inviare.contesto is
  'Cosa deve succedere quando la PEC parte, oltre all''invio: '
  '{tipo: "ricertificazione", profile_id} svuota accordo_pec_fallita_at della '
  'persona; {tipo: "verbale", pacchetto_id, note} registra l''esito del '
  'pacchetto (registra_esito_pec), che è ciò che sblocca la copia su Drive.';

-- ------------------------------------------------------------------ RLS
alter table public.pec_da_inviare enable row level security;

-- La coda contiene il testo integrale di messaggi con dati personali: la legge
-- solo chi ha accesso globale. Nessuna policy di scrittura — l'assenza
-- significa divieto totale, ed è il comportamento voluto: la coda la riempie
-- il server (service_role) dentro le server action, e la aggiorna lo script.
drop policy if exists pec_da_inviare_select on public.pec_da_inviare;
create policy pec_da_inviare_select on public.pec_da_inviare
  for select using (public.is_admin());

revoke insert, update, delete on public.pec_da_inviare from authenticated, anon;
-- Il permesso di lettura lo togliamo anche ad anon, che lo erediterebbe dai
-- privilegi di default del progetto: qui dentro c'è il testo integrale di
-- messaggi con dati personali. La policy lo escluderebbe comunque (is_admin()
-- è falso senza sessione), ma due sbarre sono meglio di una.
revoke select on public.pec_da_inviare from anon;
grant select on public.pec_da_inviare to authenticated;
grant select, insert, update on public.pec_da_inviare to service_role;

-- La coda si legge sempre nello stesso modo: cosa resta da spedire, dalla
-- più vecchia. È anche l'indice che serve al controllo "PEC ferma da troppo".
create index if not exists pec_da_inviare_coda_idx
  on public.pec_da_inviare (stato, creato_at);
