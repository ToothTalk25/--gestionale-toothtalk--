# Prompt per Claude Code — fix flusso liberatoria soggetti esterni

## Contesto

Nessuna liberatoria è mai stata raccolta finora con l'attuale flusso: questo è un fix
pre-lancio, non serve gestire dati storici né migrazioni di record già firmati.

Il flusso pubblico di firma (`/carica-liberatoria`, azioni in `actions-liberatoria.ts`)
ha tre difetti concreti, verificati leggendo il codice:

1. Il checkbox di consenso in `carica-liberatoria/page.tsx` linka `/privacy`, che mostra
   `INFORMATIVA_PRIVACY` da `src/lib/informativa-privacy.ts`. Quel testo — per stessa
   ammissione del commento in cima al file — è il Documento 2 riscritto **rimuovendo** i
   riferimenti a chi viene intervistato, perché pensato per i Collaboratori con un
   account nel gestionale. Un terzo esterno che lo legge trova riferimenti a "profilo,"
   "modulo di nomina," meccanismi che per lui non esistono, e non legge mai la Sezione 1
   del Documento 2 reale (finalità dell'intervista, base giuridica, conservazione della
   liberatoria).

2. Il documento HTML generato e archiviato come prova della firma (in
   `firmaConOtpLiberatoria`, `actions-liberatoria.ts` righe ~668-676) è tre righe
   generiche ("Il/La sottoscritto/a [nome] autorizza il progetto ToothTalk a riprendere
   e pubblicare immagine e voce..."). Il Documento 2 ufficiale
   (`public/documenti/2-informativa-liberatoria-esterni.pdf`) contiene una Sezione 2
   con dichiarazioni di consenso, presa d'atto, rinuncia a pretese economiche,
   dichiarazione di maggiore età e una clausola di manleva per diffamazione — nessuna
   di queste finisce nel documento archiviato oggi.

3. `tipo_soggetto: "maggiorenne"` viene scritto in automatico (righe ~536 e ~730) senza
   che l'interessato l'abbia mai dichiarato: non esiste, oggi, alcun checkbox o campo
   che gli sottoponga quella dichiarazione. Il Documento 2 prevede invece che sia
   proprio l'interessato a dichiararla ("DICHIARO INOLTRE: di essere maggiorenne"),
   confermata insieme al resto tramite l'OTP.

Il meccanismo OTP in sé **non va toccato**: il Documento 2 lo prevede esplicitamente
("la conferma avviene inserendo il codice OTP... non è richiesta alcuna compilazione
manuale di nome, data o firma") — è la firma elettronica del contenuto che manca, non
il meccanismo di identità.

## Testo ufficiale da usare (Documento 2, verbatim dal PDF firmato)

### Sezione 1 — Informativa sul trattamento dei dati personali

1. **Titolare del trattamento**: Il Titolare del trattamento è Enrico Maria Guarino, in
   qualità di titolare del progetto editoriale "Tooth Talk™", con sede in Via Bozzano
   n.11 16143 Genova, C.F. GRNNCM05H20C342W, e-mail: enricoguarino25@gmail.com, PEC:
   enricomariaguarino@postecertifica.it.

2. **Responsabile della protezione dei dati (DPO)**: Non è stato designato un
   Responsabile della protezione dei dati, in quanto il trattamento non rientra nelle
   ipotesi di cui all'art. 37 del Regolamento UE 2016/679 (GDPR). Per qualsiasi
   questione relativa al trattamento dei dati personali, è possibile contattare il
   Titolare ai recapiti di cui al punto 1.

3. **Finalità del trattamento**: I Suoi dati personali (immagine, voce, dichiarazioni,
   nome, cognome, qualifica professionale, etc.) saranno trattati per le seguenti
   finalità: a) Realizzazione di contenuti editoriali nell'ambito del Progetto "Tooth
   Talk™", finalizzato alla divulgazione della cultura della prevenzione odontoiatrica;
   b) Pubblicazione e diffusione dei contenuti su canali nazionali, europei e
   internazionali, ivi inclusi, a titolo esemplificativo e non esaustivo: sito web,
   piattaforme social (Instagram, Facebook, LinkedIn, YouTube), podcast, newsletter,
   pubblicazioni cartacee e digitali, e ogni altra forma di comunicazione presente e
   futura; c) Conservazione degli archivi editoriali del Progetto.

4. **Base giuridica del trattamento**: Il trattamento dei Suoi dati personali è basato
   esclusivamente sul Suo consenso esplicito manifestato mediante la sottoscrizione
   della liberatoria di cui alla Sezione 2 del presente documento (art. 6, par. 1,
   lett. a, GDPR).

5. **Categorie di dati personali trattati**: Dati identificativi e anagrafici (nome,
   cognome, data di nascita, luogo di nascita, etc.); dati relativi alla qualifica
   professionale o accademica; dati relativi alle dichiarazioni e opinioni espresse nel
   corso dell'intervista; immagine e voce (non sottoposte a trattamento automatizzato
   di riconoscimento facciale o biometrico, costituiscono dati personali ordinari ai
   sensi dell'art. 6 GDPR, non dati particolari ex art. 9, in conformità al
   Considerando 51 del GDPR); dati tecnici di connessione (indirizzo IP, informazioni
   sul dispositivo, data e ora) raccolti al momento della sottoscrizione digitale della
   liberatoria, ai fini della tracciabilità e della prova della sottoscrizione.

6. **Modalità del trattamento**: I Suoi dati personali saranno trattati con strumenti
   informatici e telematici, nel rispetto delle misure di sicurezza adeguate ai sensi
   dell'art. 32 GDPR. Il trattamento avviene interamente in formato digitale tramite il
   gestionale del Progetto; non è prevista alcuna raccolta o conservazione di documenti
   cartacei contenenti i Suoi dati.

7. **Destinatari dei dati e trasferimento extra-UE**: I Suoi dati personali potranno
   essere comunicati a: Collaboratori e volontari del Progetto "Tooth Talk™" che
   partecipano alla realizzazione dei contenuti editoriali, in qualità di persone
   autorizzate (art. 29 GDPR); fornitori di servizi tecnici e piattaforme digitali (es.
   hosting, cloud storage), in qualità di responsabili del trattamento. Trasferimento
   extra-UE: i contenuti saranno pubblicati su piattaforme social le cui società madri
   hanno sede negli Stati Uniti. Meta (Instagram/Facebook) e Google (YouTube) operano
   come titolari autonomi del trattamento per i dati elaborati sulle rispettive
   piattaforme. Tali trasferimenti si basano sulle garanzie adeguate previste dal GDPR,
   incluso il Data Privacy Framework UE-USA (Decisione di adeguatezza della Commissione
   Europea 10 luglio 2023) e/o le clausole contrattuali standard (SCC). Per eventuali
   future pubblicazioni su altre piattaforme con sede in Paesi terzi, il Progetto
   provvederà a integrare la presente informativa e a ottenere il consenso specifico
   dell'interessato, ove richiesto.

8. **Periodo di conservazione dei dati**: I Suoi dati personali saranno conservati per
   il tempo strettamente necessario al perseguimento delle finalità editoriali del
   Progetto. Termine generale: massimo 10 (dieci) anni dalla data di realizzazione del
   contenuto, tetto massimo e non default automatico. Revisione periodica: il
   Coordinatore effettuerà una revisione almeno ogni 5 (cinque) anni per valutare se i
   contenuti mantengano un interesse editoriale/documentale; solo con motivazione
   scritta di rilevanza storica, culturale o scientifica il termine potrà essere
   prorogato. In assenza di tale revisione motivata, i dati vengono cancellati da tutti
   i supporti allo scadere del quinto anno. Conservazione della liberatoria
   sottoscritta: conservata separatamente per 10 (dieci) anni dalla data del sigillo
   del contenuto a cui si riferisce, estendibile finché il contenuto pubblicato rimane
   online, con le stesse modalità di revisione. I materiali certificati del pacchetto
   sigillato e l'archivio delle comunicazioni PEC relative sono conservati per 10
   (dieci) anni dalla data del sigillo, estendibile di ulteriori 5 (cinque) anni per
   esigenze di tutela legale, ai sensi dell'art. 17, par. 3, lett. e), GDPR e artt.
   2946-2947 c.c.

9. **Diritti dell'interessato**: Accesso (art. 15), Rettifica (art. 16), Cancellazione
   (art. 17), Limitazione (art. 18), Opposizione (art. 21), Portabilità (art. 20),
   Revoca del consenso (art. 7) in qualsiasi momento senza pregiudicare la liceità del
   trattamento basata sul consenso prima della revoca, diritto di proporre reclamo
   all'Autorità Garante (www.garanteprivacy.it).

10. **Esercizio dei diritti**: e-mail enricoguarino25@gmail.com, PEC
    enricomariaguarino@postecertifica.it, indirizzo postale Via Bozzano n.11 16143
    Genova.

11. **Obbligo di fornitura dei dati**: Il conferimento dei Suoi dati personali è
    facoltativo. L'eventuale rifiuto di fornire i dati o di prestare il consenso
    comporterà l'impossibilità di realizzare l'intervista e di utilizzare i Suoi
    contenuti nell'ambito del Progetto "Tooth Talk™".

### Sezione 2 — Liberatoria per la registrazione, l'utilizzo e la diffusione di immagini, voce e dichiarazioni

Io sottoscritto/a **{{NOME}}**, con recapito **{{EMAIL_O_PEC}}**,

DICHIARO E CONSENSO di essere stato/a debitamente informato/a circa le finalità, le
modalità e i canali di diffusione del progetto editoriale di cui all'oggetto.

PRENDO ATTO CHE: il Progetto "Tooth Talk™" è un'iniziativa editoriale senza scopo di
lucro finalizzata alla divulgazione della cultura della prevenzione odontoiatrica; la
mia intervista/dichiarazione verrà registrata in formato audio/video/fotografico; i
contenuti saranno diffusi su canali nazionali, europei e internazionali, ivi inclusi, a
titolo esemplificativo e non esaustivo: sito web, piattaforme social (Instagram,
Facebook, LinkedIn, YouTube), podcast, newsletter, pubblicazioni cartacee e digitali, e
ogni altra forma di comunicazione presente e futura; i contenuti potranno essere
modificati, montati, adattati e integrati con altri materiali, nel rispetto della
finalità editoriale del Progetto; la mia partecipazione è volontaria e non prevede
alcun compenso o rimborso spese.

CONSENTO PERTANTO: alla registrazione della mia immagine, della mia voce e delle mie
dichiarazioni; alla riproduzione, distribuzione, comunicazione al pubblico e messa a
disposizione del pubblico dei contenuti sopra descritti; alla conservazione dei
materiali registrati presso gli archivi del Progetto "Tooth Talk™" per la durata
necessaria al perseguimento delle finalità editoriali; all'utilizzo dei contenuti per
finalità connesse al Progetto, incluse eventuali iniziative di promozione e
divulgazione.

RINUNCIO ESPRESSAMENTE: a qualsiasi pretesa economica o risarcitoria in relazione
all'utilizzo dei contenuti; al diritto di controllo preventivo sui contenuti editati.

DICHIARO INOLTRE: **di essere maggiorenne e pienamente capace di intendere e volere**;
che le dichiarazioni rilasciate sono veritiere, accurate e non diffamatorie nei
confronti di terzi, e che ne assumo piena e personale responsabilità; di essere stato/a
informato/a dei miei diritti ai sensi del Regolamento UE 2016/679 (GDPR) e del D.Lgs.
196/2003 e s.m.i., in particolare dei diritti di accesso, rettifica, cancellazione,
limitazione, opposizione e portabilità dei dati personali, che potrò esercitare
contattando il Titolare del trattamento ai recapiti indicati nella Sezione 1.

MANLEVA PER DIFFAMAZIONE: L'intervistato dichiara che le proprie dichiarazioni sono
veritiere e rilasciate sotto la propria esclusiva responsabilità, e si obbliga a
manlevare e tenere indenne il Progetto "Tooth Talk™" e i suoi rappresentanti da
qualsiasi pretesa, richiesta risarcitoria o azione promossa da terzi in relazione al
contenuto delle dichiarazioni rese, incluse eventuali pretese per diffamazione o
lesione della reputazione, fatta salva l'ipotesi di montaggio palesemente
manipolatorio da parte del Progetto che ne stravolga il senso, che rimane di esclusiva
responsabilità del Progetto.

REVOCA DEL CONSENSO E RIMOZIONE DEI CONTENUTI: il presente consenso è revocabile in
qualsiasi momento, senza obbligo di indicarne il motivo, mediante comunicazione scritta
al Coordinatore del Progetto "Tooth Talk™" (enricoguarino25@gmail.com); la revoca non
pregiudica la liceità del trattamento basata sul consenso prima della revoca. Per un
contenuto già pubblicato, la conservazione e diffusione si fonda anche sul legittimo
interesse del Progetto (art. 6.1.f GDPR); ci si può opporre in qualsiasi momento ai
sensi dell'art. 21 GDPR; il Coordinatore, ricevuta una richiesta di rimozione o
opposizione, bilancia gli interessi e risponde entro 30 (trenta) giorni.

DICHIARAZIONE E CONFERMA (UNICA): L'interessato, presa visione dell'Informativa
(Sezione 1) e della Liberatoria (Sezione 2) sopra riportate, DICHIARA di averle lette e
comprese integralmente, e ACCONSENTE a quanto ivi previsto. La conferma avviene
inserendo il codice OTP di 6 cifre inviato all'indirizzo email o PEC indicato, che
genera contemporaneamente entrambe le dichiarazioni, con timestamp e identità del
recapito registrati automaticamente dal sistema, in data **{{DATA}}**.

## Modifiche richieste

1. **Nuovo modulo** (es. `src/lib/liberatoria-documento2.ts`) che esporta il testo
   sopra come dato strutturato riusabile sia per il rendering a schermo sia per la
   generazione del documento HTML archiviato, con placeholder `{{NOME}}`,
   `{{EMAIL_O_PEC}}`, `{{DATA}}` sostituibili a runtime. Non riscrivere il testo, è
   quello legalmente approvato: copiarlo verbatim da questo prompt.

2. **`carica-liberatoria/page.tsx`**: sostituire il singolo checkbox con link a
   `/privacy` con il rendering integrale (scrollabile, in un riquadro dedicato) di
   Sezione 1 + Sezione 2 del Documento 2, sopra al pulsante "Invia codice di verifica".
   Aggiungere, oltre alla checkbox di consenso già esistente, una **seconda checkbox
   distinta e obbligatoria**: "Dichiaro di essere maggiorenne e pienamente capace di
   intendere e volere." Il pulsante "Invia codice di verifica" resta disabilitato finché
   entrambe non sono spuntate. Sotto il form, aggiungere la nota: "Se sei minorenne, non
   procedere qui: scrivi a enricoguarino25@gmail.com per la liberatoria con il consenso
   di un genitore/tutore." Non implementare nessun percorso automatico per minori: è
   una scelta esplicita, non un'omissione — se qualcuno non può spuntare quella
   checkbox, il flusso si ferma e basta.

3. **`actions-liberatoria.ts`**: aggiungere un parametro obbligatorio
   `dichiaraMaggiorenne: boolean` a `richiediOtpLiberatoria` e `firmaConOtpLiberatoria`
   (quest'ultima è l'unica collegata a una UI). Validare **lato server** prima di
   qualunque generazione di documento: se `false`, ritornare errore
   "Devi dichiarare di essere maggiorenne per procedere con questo modulo." — non
   fidarsi della sola checkbox lato client, dato che le server action sono chiamabili
   direttamente.

4. Sostituire il testo HTML generato in `firmaConOtpLiberatoria` (righe ~668-676
   attuali) con il rendering completo di Sezione 1 + Sezione 2 dal nuovo modulo, con
   nome/recapito/data effettivi al posto dei placeholder. Il documento archiviato deve
   corrispondere esattamente a quello approvato dal Titolare (Documento 2), non a un
   riassunto.

5. **`firmaLiberatoriaOnline`**: risulta definita in `actions-liberatoria.ts` ma non
   importata da nessun'altra parte del codice (verificato via grep) — non è collegata
   a nessuna UI. Segnalamelo esplicitamente prima di decidere: o la elimini come codice
   morto, o la allinei alle stesse modifiche (punti 3-4) se prevedi di riusarla in
   futuro (es. firma su carta scansionata). Non lasciarla nello stato attuale, con lo
   stesso difetto del `tipo_soggetto` hardcoded, in silenzio.

## Cosa NON toccare

- Il meccanismo OTP (generazione, hash, scadenza 10 minuti, rate limit) resta
  identico — è già conforme al Documento 2.
- `informativa-privacy.ts` e `/privacy` restano invariati: sono corretti per i
  Collaboratori con account nel gestionale, non per i terzi intervistati.
- `caricaAccordo` e il flusso di firma dell'Accordo Editoriale dei Collaboratori non
  sono coinvolti in questo fix.

## Verifica richiesta prima del commit

Prima di committare, mostrami:
- il rendering della pagina `/carica-liberatoria` aggiornata (testo integrale visibile,
  entrambe le checkbox, pulsante disabilitato se manca una delle due);
- l'HTML generato per una firma di prova (deve contenere tutte le clausole di Sezione
  2, non la versione a tre righe);
- conferma che chiamando `firmaConOtpLiberatoria` direttamente con
  `dichiaraMaggiorenne: false` il server rifiuta, indipendentemente dal client.

Non committare né pushare senza il mio ok esplicito.
