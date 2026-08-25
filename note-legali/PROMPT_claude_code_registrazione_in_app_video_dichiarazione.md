Contesto: revisione del flusso del video di dichiarazione (Protocollo
Art. 4.1 — identità, recapito e domande dell'intervistato, terzo non
aderente al Progetto, quindi punto delicato dal lato GDPR). Ho verificato
`src/components/PacchettoVideo.tsx` e `src/app/actions-pacchetto.ts`
prima di scrivere questo prompt: gli slot "7 · Video di dichiarazione" e
"7b · Video di integrazione" sono già caselle dedicate dentro "Video
completo" (righe ~507-615 di `PacchettoVideo.tsx`), separate dai
materiali di lavorazione — su questo non c'è nulla da correggere. Quattro
cose mancano o vanno cambiate.

## 1. Registrazione video diretta dal gestionale (nuova funzionalità)

Oggi lo slot 7/7b usa `<UploadDeliverable accept="video/*">`: un
caricamento file. Chi deve registrare il video di dichiarazione lo fa
oggi con l'app fotocamera del telefono (il video finisce nella galleria
del dispositivo) e poi carica il file risultante. Enrico vuole
un'alternativa diretta dentro il gestionale, per evitare che si crei una
copia nella galleria personale del Collaboratore che poi va ricordata di
cancellare.

Serve un componente di registrazione in-browser (`getUserMedia` +
`MediaRecorder`, standard web API, non serve nulla di esotico) da
affiancare — non sostituire — all'upload file esistente in entrambi gli
slot. Flusso richiesto:

1. Il Collaboratore avvia la registrazione dalla pagina del pacchetto
   (accesso a camera/microfono del dispositivo via browser).
2. Ferma la registrazione, e può **rivedere il video prima di
   confermarlo** — playback locale, ancora nel browser, non ancora
   caricato sul server. In questa fase è ovviamente lui solo a vederlo,
   è il suo stesso dispositivo.
3. Solo alla conferma esplicita il video viene caricato sul server, con
   lo stesso meccanismo già esistente (`onCaricato` → `dopoUpload` →
   `collegaDichiarazioneIdentita`/`collegaDichiarazioneIntegrazione`,
   ruolo `dichiarazione_identita`/`dichiarazione_integrazione`, bucket
   `originali`, kind `video_grezzo`) — non serve un percorso di
   salvataggio diverso da quello attuale, solo un'origine diversa del
   file (registrato in-app invece che scelto da file system).

L'upload da file esistente **resta**, come alternativa di riserva per i
casi in cui la registrazione in-app non sia disponibile (guasto,
permessi camera negati, browser non supportato, ecc.) — non toglierlo,
i due metodi convivono.

## 2. Visibilità dopo il caricamento: solo admin, non più chi ha caricato

Oggi (`PacchettoVideo.tsx`, footer dello Slot, e migrazione
`0091_dichiarazione_identita_riservata.sql`) il video è visibile a "chi
l'ha caricato e al Coordinatore". Va cambiato: **una volta che il
caricamento è confermato e salvato sul server, il video non deve più
essere visibile a chi l'ha caricato — solo all'admin/Coordinatore**. La
logica è che chi ha registrato il video l'ha già rivisto PRIMA di
confermarlo (punto 1, fase 2) — non ha più bisogno di rivederlo dopo, e
un terzo che ha dichiarato la propria identità e i propri recapiti a
video non dovrebbe restare visibile più a lungo del necessario nemmeno a
chi ha fatto le riprese.

Questo tocca sia la RLS (`storage_dichiarazione_riservata` e le policy
`originali_select`/`versions_select` in 0091 — va tolta la clausola `or
uploaded_by = auth.uid()`, lasciando solo `is_admin()`) sia il testo nel
footer dello Slot in `PacchettoVideo.tsx` ("Visibile solo a chi l'ha
caricato e al Coordinatore" → aggiornare la frase di conseguenza).

**Importante**: il pulsante "Segnala errore (il video va ricaricato)"
deve restare disponibile a chi ha caricato, anche se non può più vedere
il file — oggi la sua visibilità nel JSX dipende da `dichiarazione &&
!isAdmin`, cioè dal fatto che l'elemento esista in `pacchetto_elementi`,
non dal poter leggere il file stesso: verifica che tolliendo l'accesso
al file il pulsante resti comunque visibile e funzionante (dovrebbe già
essere così, dato che `dichiarazione` viene letto da `pacchetto.manifest`
o dagli `elementi` del pacchetto, non dal file in sé — ma controllalo).

## 3. Nessun download per il Collaboratore, né prima né dopo il sigillo

Verifica che non esista, in nessun punto dell'interfaccia (prima del
sigillo, e dopo — quando il pacchetto è archiviato), un link o pulsante
di download del video di dichiarazione accessibile a un utente non
admin. Con la RLS corretta al punto 2 questo dovrebbe già escludere
l'accesso al file stesso per chiunque non sia admin, ma verifica anche
lato UI che non ci siano link "scarica" mostrati comunque (anche se poi
falliscono per via della RLS: un link che sembra funzionare e poi dà
errore è una cattiva esperienza, meglio non mostrarlo proprio a chi non
può usarlo).

## 4. Commento obsoleto da correggere

In `src/app/actions-pacchetto.ts`, il commento sopra
`collegaDichiarazioneIdentita` (righe ~106-116) descrive un flusso vecchio
("Segna un file già caricato nei 'materiali di lavorazione'...") che non
corrisponde più a come la funzione viene chiamata oggi (subito dopo un
caricamento diretto nello slot dedicato 7, non per taggare un file
altrove). Aggiorna il commento per riflettere il flusso reale — non
serve toccare la funzione, solo la sua descrizione, per non lasciare in
giro una documentazione fuorviante su un punto delicato dal lato GDPR.
Stessa cosa per `collegaDichiarazioneIntegrazione`, se il commento lì
ripete la stessa imprecisione.

## Cosa NON è compreso in questo prompt

Non toccare il Protocollo Operativo (`public/documenti/`): aggiornerò io
il testo per descrivere la registrazione in-app come prima via e
l'upload da file come riserva, ma solo dopo che questa funzionalità è
live e verificata — se lo scrivo prima che esista, il documento descrive
qualcosa che il codice non fa ancora, esattamente il tipo di
disallineamento che abbiamo passato la sessione a correggere altrove.
Fammi sapere quando è pronto.

## Test

Dopo l'implementazione: un utente non admin che ha appena caricato (in
qualsiasi dei due modi) il video di dichiarazione non deve poter né
vederlo né scaricarlo — solo vedere che l'elemento esiste (nome slot
compilato) e poter segnalare un errore. Solo l'admin vede/scarica il
file. La registrazione in-app funziona come alternativa, non sostituisce
l'upload da file. I commenti nel codice descrivono il flusso reale.
