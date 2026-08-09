# ToothTalk — Gestionale interno

Spazio di lavoro dei gruppi universitari + archivio dei materiali depositati, con valore probatorio.

## Vincolo di impostazione — leggere prima di scrivere qualsiasi testo

ToothTalk è un **progetto di divulgazione** a partecipazione libera, non
un'organizzazione di lavoro. Chi partecipa lo fa senza incarichi assegnati,
senza scadenze vincolanti e senza quantità minime dovute: realizza i video che
vuole, quando vuole, secondo la carta editoriale che sottoscrive.

Questo ha una conseguenza pratica **su ogni parola visibile** nella
piattaforma: qualsiasi termine che evochi un rapporto di lavoro subordinato o
parasubordinato va evitato, perché contribuirebbe a qualificare come tale un
rapporto che non lo è.

| Non usare | Usare |
|---|---|
| titolare, capo, responsabile | accesso globale (o nessuna etichetta) |
| team, collaboratore, membro dello staff | gruppo, partecipante, nome dell'università |
| consegna, consegnare (come prestazione dovuta) | deposito, depositare, caricare |
| task, incarico, assegnazione | progetto |
| da fare, respinto | in preparazione, da rivedere |

Il vincolo vale anche per i **messaggi d'errore sollevati dai trigger**
PostgreSQL: l'applicazione li inoltra tali e quali all'utente, quindi vivono
nelle migrazioni, non solo nella UI. I messaggi descrivono la restrizione
("non disponibile da qui"), mai il ruolo di chi potrebbe superarla.

Restano legittimi due usi tecnici: `consegnato` come identificativo interno
nel database, e "ricevuta di avvenuta consegna", termine ufficiale della PEC.

## Stack

| Pezzo | Scelta | Perché |
|---|---|---|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind 4 | Server Component = zero API da scrivere per la lettura dei dati |
| Auth | Supabase Auth (email + password) | Il JWT arriva fino a Postgres: le regole valgono anche se qualcuno chiama l'API a mano |
| Database | Postgres (Supabase) con RLS | I permessi stanno nel dato, non nel codice |
| Storage | Supabase Storage, 2 bucket privati | Upload diretto browser → storage: i video grezzi non passano dal server Next |
| Hash | `hash-wasm` nel browser | SHA-256 in streaming su file da GB, memoria costante |

## Avvio

Serve **Node 20+** (sulla macchina attuale non è installato: `brew install node`
oppure l'installer da nodejs.org).

```bash
npm install
```

1. Crea un progetto su [supabase.com](https://supabase.com).
2. Copia `.env.example` in `.env.local` e riempi le tre variabili.
3. Nel SQL Editor di Supabase esegui **in ordine** i file di `supabase/migrations/`:
   `0001_schema.sql` → `0002_rls.sql` → `0003_storage.sql` → `0004_views_seed.sql`
   → `0005_enum.sql` → `0006_pacchetti_pec.sql`.
   `0005_enum.sql` va eseguito **da solo**: Postgres non permette di usare un
   valore di enum nella stessa transazione in cui è stato aggiunto.
4. In *Authentication → Providers*, **disattiva la registrazione pubblica**: gli
   account li crei tu.
5. Crea te stesso e promuoviti:

```bash
npm run utente -- crea tua@email.it "PasswordForte1!" "Enrico"
npm run utente -- promuovi tua@email.it
```

6. Crea i membri e assegnali ai poli:

```bash
npm run utente -- crea mario@esempio.it "Provvisoria1!" "Mario Rossi"
npm run utente -- assegna mario@esempio.it insubria
```

7. `npm run dev` → http://localhost:3000

## Il modello dei permessi in una pagina

### Ruolo globale
Sta su `profiles.role`: `admin` (tu) oppure `member`. Un `member` non può
promuoversi: il trigger `fn_protect_profile` rifiuta qualsiasi cambio di ruolo
che non arrivi da un admin o dal service role.

### Gruppi orizzontali
`memberships(user_id, polo_id)` **non ha una colonna "ruolo interno"**. È una
scelta strutturale, non una dimenticanza: nel database non esiste un modo per
esprimere "capo del polo di Genova", quindi nessuna funzionalità futura potrà
introdurre di soppiatto una gerarchia. Ogni policy che riguarda un polo si
riduce a una domanda binaria — `is_member_of(polo_id)` — identica per tutti.

### Il workspace è libero, il pacchetto certificato è di pietra
Sono due zone con regole opposte, ed è voluto.

**Zona di lavoro — modificabile.** Un membro del polo Insubria può, in piena
autonomia e senza chiedere niente a nessuno: creare task del proprio polo,
modificarne titolo e script, caricare materiali di lavorazione, spuntare gli
stati operativi, scaricare tutto ciò che il polo ha prodotto. Un membro di
Insubria **non vede** nulla di Genova. Qui si sbaglia, si riscrive, si ricarica:
è uno spazio di lavoro, deve essere fluido.

**Zona certificata — immutabile.** Il pacchetto "Video completo" (video,
copertina, descrizione, script) una volta sigillato non è più toccabile da
nessuno, e il suo verbale parte via PEC. È la testimonianza che tutela il gruppo
e te: da lì in poi nessuno può sostenere di aver depositato qualcosa di diverso.

### Cosa resta solo tuo
Approvazione/pubblicazione, blocco dei contenuti (`tasks.locked`), note del
accesso globale, composizione dei gruppi, upload nel bucket `revisioni`, annullamento
di un pacchetto sbagliato, vista trasversale su tutti i poli.

## L'archivio di tutela legale

Il punto delicato è: *tu* modifichi i materiali prima di pubblicarli, e il gruppo
deve poter dimostrare cosa aveva depositato. Quattro meccanismi sovrapposti.

**1. Due archivi fisicamente separati.**
`originali` (materiali depositati dal gruppo) e `revisioni` (le tue lavorazioni) sono bucket
distinti, non due cartelle. Una policy sbagliata su un prefisso non può esporre
o intaccare l'altro archivio.

**2. Il bucket `originali` non ha policy di UPDATE né di DELETE.**
Per nessuno. Nemmeno per te. Con la tua sessione da accesso globale puoi leggere e
scaricare un originale, ma il database rifiuta qualsiasi tentativo di
sovrascriverlo o cancellarlo. È il motivo per cui l'upload usa `upsert: false`:
un upsert genererebbe una UPDATE e verrebbe respinto.

**3. Il registro `deliverable_versions` è append-only e concatenato.**
Nessuna policy di UPDATE/DELETE, più un trigger (`fn_versions_append_only`) che
solleva un'eccezione anche quando la chiamata arriva dal service role. Ogni
riga porta:
- `sha256` del contenuto, calcolato nel browser prima dell'upload;
- `record_hash` = SHA-256 di *(hash del record precedente + questi metadati)*,
  calcolato dal server — se qualcuno alterasse una riga a valle, tutti gli hash
  successivi smetterebbero di tornare;
- `sealed_at`, orario del server, non del client.

`select * from verifica_catena('<deliverable_id>')` ricalcola l'intera catena e
dice quali record sono integri. Lo stesso controllo è esposto nella pagina
*Attestazione di deposito*, stampabile in PDF: il membro del gruppo ha in mano un
documento con nome file, impronta, data di sigillo e catena verificata.

**4. Le due versioni non si sovrascrivono mai.**
Le policy impediscono a te di inserire una riga con `origin = 'originale'` e ai
membri di inserirne una con `origin = 'admin_edit'`. Il vincolo
`chk_origin_bucket` lega ciascuna origine al proprio bucket. Nella scheda della
task le due colonne stanno affiancate: "Consegna originale del gruppo" e
"Versione di chi ha accesso globale".

## Il pacchetto "Video completo" e la PEC

Non tutto merita di essere certificato. I materiali di lavorazione — girato
grezzo, liberatorie, bozze di script, audio — cambiano, si accumulano e sono
materiale di processo: restano immutabili nell'archivio, ma **non vengono
spediti via PEC**.

Ciò che finisce sui social è un'altra cosa, ed è l'unica da cui gruppo e accesso globale
devono davvero tutelarsi. Il **pacchetto pubblicabile** ha esattamente quattro
elementi:

| # | Elemento | Forma |
|---|---|---|
| 1 | Video montato | file, bucket `finali` |
| 2 | Copertina | file, bucket `finali` |
| 3 | Descrizione da pubblicare | testo nella scheda |
| 4 | Script usato per il video | testo nella scheda |

Vive in un **terzo bucket** (`finali`) con le stesse regole di `originali`:
nessuna policy di UPDATE o DELETE, per nessuno.

### Il sigillo
Quando ci sono tutti e quattro, chiunque del polo preme *Sigilla il pacchetto*.
La funzione `sigilla_pacchetto()` — non l'applicazione — costruisce un
**manifesto** leggendo le righe già sigillate del registro: nomi file, impronte
SHA-256, chi ha caricato cosa e quando, più il testo integrale di descrizione e
script con la loro impronta. Il manifesto viene hashato a sua volta
(`manifest_hash`) e congelato. Nessuno può farsi certificare qualcosa di diverso
da ciò che ha effettivamente caricato, perché il client non fornisce nessuno di
quei dati.

Il pacchetto punta alla **versione esatta** usata, non alla deliverable: se
domani il gruppo carica un nuovo montaggio, il pacchetto certificato continua a
riferirsi al file davvero spedito.

### La PEC
*Invia il verbale via PEC* spedisce dalla casella PEC configurata alla casella
PEC configurata (auto-invio), con i membri del polo in copia sulla loro email
ordinaria — così la prova non sta soltanto nella tua cassetta.

Allegati: copertina, `descrizione.txt`, `script.txt`, `manifesto.json`. Il video
**no**, quasi sempre: i gestori italiani si fermano fra i 30 e i 100 MB per
messaggio. È il motivo per cui il verbale certifica le impronte — un SHA-256
identifica il file in modo univoco, quindi la PEC dà data certa al *contenuto*
del video senza doverlo trasportare. La soglia è in `PEC_MAX_ALLEGATO_MB`; ciò
che resta fuori è elencato esplicitamente nel messaggio.

Prima di allegare un file, il server ne ricalcola l'impronta e la confronta con
quella registrata: se divergono la spedizione si ferma, invece di certificare un
contenuto diverso da quello depositato.

L'esito (message-id, data, destinatari) è scritto **solo con la service role
key**, lato server: `registra_esito_pec` è revocata a `PUBLIC`, `anon` e
`authenticated`, quindi dal browser è irraggiungibile. Un membro non può
marcare un pacchetto come "PEC inviata" senza che la PEC sia partita davvero.

Chi ha accesso globale può *annullare* un pacchetto sbagliato indicando un motivo: quello
annullato resta a registro per sempre e se ne compone uno nuovo.

### Cosa prova, esattamente
La ricevuta di avvenuta consegna del gestore PEC attesta che quel contenuto —
e quindi quelle impronte — esistevano a quella data. Combinata con il registro
append-only e la catena di hash, il gruppo può dimostrare *cosa* ha depositato e
*quando*, anche se la versione pubblicata è diversa.

Va detto con onestà: l'auto-invio parte da una casella che controlli tu. Verso
il gruppo è comunque una garanzia forte, perché ricevono la stessa copia con le
impronte in tempo reale e la conservano loro. Se in futuro serve una prova più
robusta verso terzi, il passo è un timestamping qualificato eIDAS sul
`manifest_hash`, che si innesta esattamente nello stesso punto del flusso.

### Limite dichiarato
Chi possiede le credenziali del progetto Supabase (o l'accesso al pannello) è
proprietario delle tabelle e può, in linea di principio, disabilitare i trigger
o cancellare righe con una connessione diretta al database. Nessuno schema può
impedirlo dall'interno. Ciò che questo impianto garantisce è che **il percorso
applicativo non lo consente mai**, che una manomissione fuori applicazione rompe
la catena di hash in modo rilevabile, e che per i contenuti pubblicabili esiste
una copia certificata **fuori dal database**, nella cassetta PEC e nelle email
dei membri del polo. È proprio la PEC a chiudere questo buco: il database può
anche essere manomesso, il verbale spedito no.

## Struttura

```
supabase/migrations/   schema, RLS, storage, viste
src/app/actions.ts     server action (le uniche scritture applicative)
src/app/(app)/         dashboard, polo, task, admin, certificato
src/components/        upload, lista versioni, controlli stato
src/lib/               client Supabase, sessione, hash, PEC
src/proxy.ts           rinnovo sessione + redirect a /login (era "middleware")
scripts/               amministrazione utenti (service role)
```

## Flusso di una task

1. Chiunque nel polo crea la task → `da_fare`.
2. Il gruppo carica i materiali di lavorazione (grezzo, liberatorie): ogni file
   viene hashato, caricato in `originali/`, sigillato nel registro → la task
   passa a `consegnato`.
3. Il gruppo compone il **Video completo**: video montato + copertina in
   `finali/`, descrizione e script nella scheda. Preme *Sigilla* → manifesto
   congelato. Preme *Invia via PEC* → verbale spedito, data certa acquisita.
4. Tu metti la task `in_revisione` e aggiungi le note di chi ha accesso globale.
5. Carichi la tua versione montata in `revisioni/` → `modificato_admin`.
   Il pacchetto originale resta intatto, certificato e scaricabile dal gruppo.
6. `approvato` → `pubblicato` (con l'URL del video online).
7. Blocchi la task: il polo non modifica più nulla, ma continua a vedere e
   scaricare tutto.
