# Contesto del progetto — leggere prima di modificare qualsiasi cosa

Documento di riferimento per chiunque (persona o assistente AI) intervenga sul
codice. Non descrive *come* è fatto — quello si legge nel codice — ma **perché**
è fatto così. Diverse scelte che sembrano complicazioni inutili sono vincoli
deliberati: cambiarle senza sapere il motivo rompe la ragion d'essere del
progetto.

---

## 1. Cos'è ToothTalk (e cosa NON è)

Progetto di **divulgazione odontoiatrica**. Gruppi di studenti di diverse
università realizzano video che vengono pubblicati sui canali del progetto.

**La partecipazione è libera**: nessun incarico assegnato, nessuna scadenza
vincolante, nessuna quantità minima dovuta. Ognuno realizza i video che vuole,
quando vuole, secondo la carta editoriale che sottoscrive.

Questa piattaforma è **uno spazio di lavoro condiviso**, non un sistema di
gestione del personale. Sostituisce cartelle sparse su Drive e file rimbalzati
nelle chat.

## 2. Vincolo di terminologia — NON negoziabile

Nessuna parola visibile deve evocare un rapporto di lavoro subordinato o
parasubordinato, perché contribuirebbe a qualificare come tale un rapporto che
non lo è.

| Mai usare | Usare |
|---|---|
| titolare, capo, responsabile, referente | accesso globale, oppure nessuna etichetta |
| team, collaboratore, staff, dipendente | gruppo, partecipante, nome dell'università |
| consegna / consegnare (come prestazione dovuta) | deposito, depositare, caricare |
| task, incarico, assegnazione, commessa | progetto |
| da fare, respinto, scadenza obbligatoria | in preparazione, da rivedere |

**Il vincolo vale anche per i messaggi d'errore dentro le migrazioni SQL**:
l'applicazione li inoltra all'utente parola per parola (vedi `fallita()` in
`src/app/actions.ts`). Non basta cambiare l'interfaccia.

I messaggi descrivono **la restrizione** ("non disponibile da qui"), mai il
ruolo di chi potrebbe superarla.

Due usi tecnici restano legittimi: `consegnato` come identificativo interno nel
database, e "ricevuta di avvenuta consegna", termine ufficiale della PEC.

## 3. Le due zone, con regole opposte

È la distinzione portante di tutto il sistema.

**Zona di lavoro** (bucket `originali`) — girato grezzo, bozze, materiali di
servizio. Chi partecipa carica, scarica, corregge, ricarica **ed elimina**
liberamente. Nessun valore probatorio, nessuna limitazione. Deve restare
fluida: è lo spazio dove si sbaglia.

**Zona certificata** (bucket `finali`) — il pacchetto pubblicabile: video
montato, copertina, descrizione, script, e liberatoria se il video mostra
persone esterne. Finché è in bozza si corregge e si rimuove; **dal momento del
sigillo diventa immutabile per chiunque**, e il verbale parte via PEC.

Tre difese indipendenti proteggono il sigillato: il trigger
`fn_versions_append_only`, il vincolo di chiave esterna `on delete restrict`, e
`fn_elementi_congelati`. Sono ridondanti apposta.

**Il magazzino del gruppo** (`documenti_magazzino` + bucket `magazzino`) sta
nella zona di lavoro: materiali di servizio che non appartengono a un progetto
(moduli, guide, immagini di riferimento), quindi senza catena di impronte e
cancellabili da tutto il gruppo. Bucket separato per la stessa ragione degli
altri: una policy sbagliata qui non può toccare i materiali di progetto.

**Doppio ruolo.** Chi ha accesso globale e appartiene anche a un gruppo lavora
lì come un partecipante — deposita versioni originali, compone il pacchetto —
e conserva i poteri globali per il resto. Fuori dai propri gruppi deposita
versioni derivate, come sempre.

## 4. Come funziona la prova (il punto meno intuitivo)

La PEC non trasporta il video quando è grosso: i gestori si fermano a 50-100 MB
per messaggio, e la codifica base64 gonfia i file di un terzo.

**Non è un problema, perché il video non deve viaggiare.** Chi lo ha realizzato
ne conserva la propria copia. Quello che serve è fissare *cosa era quel file e
in che data*: lo fa l'impronta SHA-256 dentro la PEC. Se domani nasce una
contestazione, si ricalcola l'impronta del proprio file e si confronta con
quella certificata. È il modo standard di provare esistenza e integrità di un
file digitale.

**Descrizione e script viaggiano invece sempre integrali**, nel corpo del
messaggio e come allegato: sono testo, non pesano. Lo script è di fatto la
trascrizione di ciò che il video dice, quindi certifica il contenuto anche
senza il file video. È l'elemento più prezioso del pacchetto.

Gli allegati si scelgono **dal più leggero al più pesante** finché c'è spazio,
così liberatoria e copertina entrano sempre.

La PEC va alla casella configurata **e in copia a chi partecipa al gruppo**: la
prova non deve stare in un'unica cassetta.

## 5. Permessi

Stanno nel **database** (Row Level Security), non nel codice applicativo. Se una
policy cambia, l'applicazione si adegua da sola. Le server action non
implementano controlli: costruiscono query oneste e traducono gli errori.

**I gruppi sono orizzontali.** La tabella `memberships` non ha una colonna per
un ruolo interno: nel database non esiste modo di esprimere "coordinatore di
Messina", quindi nessuna funzionalità futura può introdurre una gerarchia di
soppiatto. Tutti i partecipanti di un gruppo hanno esattamente gli stessi
poteri.

**Il varco dell'Accordo è anche nel database** (migrazione `0137`). Fino a ieri
la regola viveva solo nel proxy e nel layout: chi aveva una sessione ma
l'Accordo incompleto poteva chiamare l'API direttamente (PostgREST con la
chiave anon, che il browser ha) e leggere i progetti del proprio gruppo. Ora
una funzione — `accesso_progetti()`, che rispecchia `accordoCompleto()` di
`src/lib/accordo.ts` campo per campo — e una serie di policy **restrictive**
(che si sommano a quelle esistenti, non le riscrivono: chi decide *chi* vede
resta quello di prima) chiudono l'accesso a progetti, materiali, versioni,
pacchetti, richieste di modifica, magazzino e ai quattro bucket dell'area
progetti. Restano aperti profilo, consensi, inviti, domande di supporto e il
bucket `profili`: sono le cose che servono per **completare** l'Accordo, e
chiuderle impedirebbe a chi è fuori di rientrare. Le due soglie sono le stesse
dell'app: la controfirma conta solo per chi è stato approvato dal 7 settembre
2026 in poi, e il giorno di scadenza appartiene ancora al periodo.

Verificato in produzione con `scripts/_e2e_varco_accordo.mjs` (chiave anon e
sessione utente, cioè la stessa richiesta che fa un browser): un membro senza
Accordo vede 0 progetti e 0 materiali ma continua a leggere il proprio profilo
(quindi può ancora caricare l'Accordo), un membro con Accordo completo vede il
progetto del suo gruppo, con l'Accordo scaduto ieri ne vede 0, con l'Accordo
che scade oggi ne vede ancora 1, e l'accesso globale li vede tutti.

Chi ha `role = 'admin'` ha accesso trasversale a tutti i gruppi. Non compare
nessuna etichetta accanto al nome: la differenza si vede solo dalle voci di menu
disponibili.

**Il Collaboratore Tecnico** (`role = 'tecnico'`, migrazioni `0133`-`0135`) è
una figura esterna con un proprio accesso, limitato a una cosa sola: la coda
delle domande tecniche in `/tecnico`. Non ha accordo editoriale né appartenenza
a un gruppo, quindi la RLS non gli mostra gruppi, progetti, magazzino o chat;
delle domande vede solo quelle tecniche, e di chi le scrive vede **solo il nome
di battesimo** (`nome_battesimo()`, che per tutti gli altri ruoli restituisce
null). La sua risposta arriva direttamente a chi ha chiesto, senza passare
dall'accesso globale; un trigger gli permette di scrivere solo i tre campi della
risposta, non di riscrivere la domanda. Il Documento 5 va aggiornato di
conseguenza: era scritto sull'ipotesi "solo PEC, nessun profilo applicativo".

Verificato con prova reale: un partecipante di Messina che digita a mano
l'indirizzo di un altro gruppo riceve 404, non una pagina vuota.

## 6. Liberatoria condizionale

Sul progetto c'è l'interruttore `coinvolge_terzi`: lo attiva chi realizza il
video quando compare una persona esterna. Se attivo, la liberatoria diventa un
elemento **obbligatorio** del pacchetto e blocca il sigillo finché manca — il
controllo è in `sigilla_pacchetto()`, non nell'interfaccia.

Scelta deliberata: non è il *formato* del video a determinarlo (due video dello
stesso formato possono differire), ma chi ha girato quel video specifico.

## 7. Revisione

I video sigillati finiscono nella coda `/revisione`. Da lì si aprono
**richieste di modifica** con ambito (video, copertina, descrizione, script,
generale).

Le richieste **non toccano il pacchetto sigillato** — quello resta immutabile,
ed è il motivo per cui vale. Compaiono in cima alla scheda del progetto, dove il
gruppo le vede. Il testo di una richiesta non è riscrivibile: se cambia idea, se
ne apre un'altra.

Se servono correzioni sostanziali, il pacchetto va **annullato** (resta a
registro con il suo verbale PEC già spedito) e se ne compone uno nuovo.

## 8. Costi e spazio

Il modello scelto tiene i costi vicini a zero:

- i file restano sulla piattaforma solo il tempo di scaricarli e pubblicare
- dopo l'invio PEC si possono eliminare: la copia definitiva è nella PEC, in due
  caselle diverse
- lo spazio non cresce mai → si resta nel piano gratuito di Supabase

Il girato grezzo **non va conservato nel cloud**: è la voce che farebbe esplodere
i costi (500 MB a video), ed è già progettato come eliminabile.

Se un domani il traffico diventasse il collo di bottiglia, l'alternativa è
Cloudflare R2 (nessun costo di traffico in uscita). Cambiare storage **non
indebolisce la prova**: quella vive nella catena di impronte e nella PEC, non
nei byte.

## 9. Regole tecniche da rispettare

**Migrazioni.** Da `0001` a `0138` sono già state applicate al database reale.
**Non modificarle**: file e database divergerebbero. Per cambiare qualcosa si
aggiunge un file nuovo (`0018_...sql`) e si lancia `npm run migra -- 0018`.

I file che aggiungono valori a un enum (`0005`, `0010`, `0012`, `0133`) vanno
eseguiti **da soli**: Postgres non permette di usare un valore di enum nella
stessa transazione in cui è stato creato.

**`.env.local`** contiene le chiavi vere ed è escluso da git. Non committarlo,
non stamparlo, non incollarlo in chat.

**`SUPABASE_SERVICE_ROLE_KEY`** bypassa la RLS. Va usata solo lato server e in un
unico punto dell'applicazione: la registrazione dell'esito PEC, che deve essere
impossibile dal browser (altrimenti un partecipante potrebbe marcare un
pacchetto come "PEC inviata" senza averla spedita).

**Upload.** I file non passano dalle server action: il browser carica
direttamente su Supabase Storage e al server arrivano solo i metadati. Per
questo `bodySizeLimit` è a 1 MB e va lasciato lì.

L'upload usa `upsert: false` obbligatoriamente: sui bucket immutabili non esiste
policy di UPDATE, quindi un upsert verrebbe respinto.

## 10. Stato e cose aperte

Aggiornato al 19 settembre 2026.

1. **PEC**: la casella è `toothtalk@pec.it` (Aruba). Dal 15 settembre 2026 Aruba
   rifiuta gli invii automatici del gestionale — `554 5.7.1 Indirizzo IP
   bloccato temporaneamente per sospetto abuso` — perché partivano da Vercel,
   che non ha regioni italiane e cambia indirizzo a ogni invio. Nel ticket
   `19039798A` hanno risposto che **gli IP italiani, anche dinamici, non vengono
   bloccati** e che per gli IP esteri (o per un numero elevato di indirizzi,
   come fa un cloud) l'unico rimedio che offrono è aprire la casella a tutti gli
   indirizzi — cioè rinunciare alla protezione anti-abuso su una casella che
   firma documenti con valore legale.
   Da lì la scelta: **il gestionale non spedisce più le PEC, le mette in coda**
   (migrazione `0139`) e a spedirle è `scripts/invia-pec.mjs` eseguito sul
   computer del progetto, che esce da un indirizzo italiano — quello che Aruba
   non blocca. Comandi: `npm run pec` (simulazione, verifica anche le impronte
   dei file), `npm run pec -- --esegui` (spedisce), `npm run pec -- --verifica`
   (controlla casella, accesso e coda senza spedire).
   Le credenziali della casella (`PEC_USER`, `PEC_PASSWORD`, `PEC_MITTENTE`)
   vivono in `.env.local` su questa postazione e **non servono più
   all'applicazione**: non parte più nessun invio dalla piattaforma, nemmeno il
   verbale dei pacchetti sigillati e la richiesta di liberatoria al contatto
   esterno (prima passavano di lì e sarebbero state bloccate). Su Vercel restano
   solo `PEC_DESTINATARI` (chi riceve in copia) e `PEC_MAX_MESSAGGIO_MB` (il
   tetto che decide quanti allegati entrano): le tre credenziali si possono
   togliere.
   Due promemoria tengono viva la coda, perché non si svuota da sola: una
   notifica sul telefono **appena una PEC entra in coda**, e il controllo
   notturno che ogni notte, se la coda non è vuota, manda email e notifica con
   il comando da eseguire e da quanto aspetta la PEC più vecchia.
   E la coda si svuota **da sola**: sul computer del progetto c'è un'attività
   (`it.toothtalk.pec`, launchd, ogni 15 minuti e all'accesso) che esegue
   `scripts/pec-automatico.sh`. Gira quando il computer è acceso e l'utente è
   collegato: se è spento, le PEC aspettano il risveglio e il promemoria notturno
   lo dice. Per fermarla: `launchctl bootout gui/$(id -u)/it.toothtalk.pec`.
   Un deposito rimasto senza PEC si rimanda dal Registro ("Metti in coda la PEC
   del deposito", con la frase di conferma obbligatoria, 0140): serve per le
   firme arrivate durante il blocco, e non si può fare due volte sullo stesso
   documento.
2. **Account dei partecipanti**: due strade — l'invito dal Registro globale
   (email con codice del gruppo e link di registrazione) oppure
   `npm run utente -- crea|assegna`. Le registrazioni si approvano dal Registro.
3. **Pubblicazione online**: attiva (GitHub + Vercel, `main` = produzione).
4. **Account di prova**: gli `@toothtalk.local` e i `+test…` sono stati rimossi
   o anonimizzati (`ex-…@toothtalk.local`, disattivati). Resta
   `mario.rossi.messina@esempio.it`, tenuto come partecipante di prova su Messina.
5. **Export su Google Drive**: la service account non ha quota di archiviazione,
   quindi la piattaforma non può creare file su Drive. La coda
   `esportazioni_drive` la svuota `scripts/esporta-drive.mjs` (rclone, account del
   progetto): `--verifica`, simulazione di default, `--esegui` per eseguire.
6. **Accesso del Collaboratore Tecnico**: creato l'account con ruolo `tecnico` e
   pagina `/tecnico` (le domande tecniche non passano più dall'accesso globale e
   non partono più email). L'indirizzo è ancora provvisorio
   (`tecnico@toothtalk.local`): va sostituito con quello vero prima di
   consegnarlo, perché è anche l'identificativo di accesso e finirà nel
   contratto. Password provvisoria consegnata a parte, non scritta qui: per
   rieseguire la prova `node scripts/_e2e_tecnico.mjs` la vuole in `.env.local`
   come `TECNICO_PASSWORD` (file escluso da git).

7. **Verifica IA dell'accordo**: se il controllo automatico non riesce al
   caricamento (o la chiave non era configurata sul server), l'accordo resta
   invisibile nella coda di approvazione — e un accordo invisibile è
   indistinguibile da un accordo mai caricato: è il modo in cui due accordi
   veri sono rimasti fermi per un giorno senza che nessuno lo sapesse. Dal
   Registro, in "Accordi da approvare", si rifà il controllo sul file già
   caricato ("Rivaluta con l'IA") e ci si fa mandare il PDF firmato per email
   ("Mandami il PDF"), perché la controfirma si fa a mano su carta.
   Il modello però è un servizio esterno: risponde 429/500/503 quando è
   sovraccarico e con due PDF al seguito può superare il tempo concesso alla
   funzione (504). Per questo la verifica non è mai l'unica via: l'accesso
   globale può registrare la **propria** verifica a mano, con il motivo
   obbligatorio che resta nel registro (`verifica_manuale_accordo`). La
   decisione è umana per costruzione — l'informativa privacy lo dichiara già:
   l'esito automatico non è mai la decisione.
   Un terzo modo di fallire, visto il 18 settembre 2026 su un accordo vero: la
   risposta arrivava **tagliata**. La chiamata aveva un tetto di 1024 token, e i
   modelli recenti ne consumano una parte "pensando" prima di rispondere: con un
   documento che richiede più ragionamento il budget finisce e il testo visibile
   resta vuoto — nessuna graffa, quindi "risposta non interpretabile", due volte
   di fila, senza che si potesse sapere che cosa avesse detto il modello. Ora il
   tetto è 8192, il formato JSON si chiede all'API invece di sperarlo, e quando
   la risposta resta illeggibile la nota riporta che cosa ha scritto il modello.
   Due dettagli che sembrano tecnici e non lo sono: il modello è fissato a una
   versione **stabile** (`gemini-3.5-flash`), mai all'alias `gemini-flash-latest`,
   che segue i rilasci e punta quindi al modello appena uscito, cioè a quello
   con più coda di tutti (è la causa del 503 del 18 settembre 2026, il giorno
   dopo il rilascio di Gemini 3.8); e la verifica dichiara `maxDuration`
   esplicito, perché due PDF letti e confrontati non entrano nei 60 secondi
   iniziali. Il controllo dice anche cose scomode che è bene sapere: sul primo
   accordo vero rivalutato ha risposto "documento incompleto (solo la prima
   pagina) e manca la firma" — il PDF caricato aveva una pagina sola, su nove.

8. **Integrità dei depositi**: il controllo notturno (migrazione `0138`) gira
   dentro il database (sveglia `pg_cron` alle 04:00) e ricontrolla la catena
   delle impronte di ogni materiale, l'impronta del manifesto di ogni pacchetto
   sigillato e la presenza dei file (esistenza e dimensione dichiarata). Se
   trova qualcosa che non torna, il cron `/api/cron/integrita` avvisa email e
   notifica una volta sola, e la scheda "Integrità dei depositi" nel Registro
   lo mostra con il dettaglio. Il pulsante "Controlla adesso" esegue lo stesso
   controllo su richiesta. Resta fuori da questo controllo — per scelta —
   l'impronta del *contenuto* dei file grandi: ricalcolarla vorrebbe dire
   riscaricare centinaia di MB ogni notte, e quella prova vive nella PEC e
   nella copia di chi ha girato il video.

9. **PEC in coda** (migrazione `0139`): la coda è `pec_da_inviare`, la legge
   solo l'accesso globale e la scrive solo il server; il Registro ha la scheda
   "PEC da spedire" con il comando da eseguire, da quanto aspetta la più
   vecchia e gli errori con il motivo (le righe in errore **non ripartono da
   sole**: un errore va letto, e si riprova una per una con `--id`).
   Due scelte che vale la pena conoscere. Primo: gli allegati in coda sono
   **riferimenti con l'impronta**, non byte — e lo script verifica l'impronta
   *prima* di spedire, perché certificare un file diverso da quello deciso
   sarebbe un falso (i documenti del progetto possono essere aggiornati nel
   frattempo, e in quel caso la PEC si ferma con un errore chiaro invece di
   partire con l'allegato sbagliato). Secondo: le cose che l'applicazione non
   può sapere in anticipo le completa lo script **dopo** che la PEC è partita —
   svuotare `accordo_pec_fallita_at`, registrare l'esito del pacchetto
   (`registra_esito_pec`, che è ciò che fa partire la copia su Drive) — perché
   altrimenti l'app mostrerebbe come fatto qualcosa che non è ancora avvenuto.
   Il controllo notturno dell'integrità avvisa ogni notte, se la coda non è
   vuota: finché è in coda, quel documento non ha data certa. Dalla coda passano
   ormai TUTTI gli invii certificati: accordi, rinnovi, verbali dei pacchetti
   sigillati e richieste di liberatoria ai contatti esterni.

10. **Accordo: chiedere di ricaricare, e confermare che è arrivato**
    (migrazione `0140`). Tre cose nate da un caso vero — un accordo caricato con
    una pagina sola su nove, che nessuno poteva segnalare alla persona se non
    scrivendole fuori dal gestionale, senza che ne restasse traccia:
    — l'accesso globale può **chiedere di ricaricare l'accordo**, con motivo
      obbligatorio: la persona lo legge nel proprio profilo, riceve un'email, e
      la richiesta resta nel registro insieme a chi l'ha chiesta. Si chiude da
      sola al primo accordo nuovo che arriva;
    — chi carica l'accordo riceve una **conferma via email** ("lo abbiamo
      ricevuto"): prima non riceveva niente, perché la PEC del deposito va
      all'accesso globale, non a lei — l'unica traccia era un messaggio a
      schermo in quel momento;
    — la **copia della PEC del deposito va sempre** alla persona (sulla sua PEC
      se l'ha indicata, altrimenti sulla sua email di accesso): prima la
      riceveva solo chi aveva una PEC, e chi non l'aveva restava senza il
      proprio documento certificato.
    L'esito automatico resta un segnale, mai la decisione: queste colonne non
    bloccano e non sbloccano niente, dicono soltanto che quella persona è stata
    avvisata. La prova end-to-end vive in `scripts/_e2e_ricarica.mjs`.
    Da sapere, perché è stato visto durante quella prova: la chiave esterna di
    `consents_and_releases` verso `profiles` **non ha cascata**, quindi
    l'eliminazione di un account che ha un accordo registrato fallisce in
    silenzio. Nel gestionale non si nota (l'uscita di una persona anonimizza,
    non elimina), ma vale per `npm run utente` e per l'Admin API.

11. **Velocità: misurata, non stimata** (19 settembre 2026). Prima di toccare
    qualsiasi cosa si è misurato, perché «più veloce» senza un numero è
    un'opinione. Tre strumenti, tutti in sola lettura:
    — `npm run audit-rls` ha una sezione **Prestazioni**: query più pesanti
      (`pg_stat_statements`), scansioni sequenziali, policy ancora valutate riga
      per riga, policy permissive multiple;
    — `scripts/_e2e_salute.mjs` è diventato un **cronometro**: crea due account
      temporanei (Collaboratore con accesso completo + account di accesso
      globale), misura per ogni pagina chiave primo byte, disegno, rete ferma e
      risorse, e misura anche i **clic dentro l'app** (navigazione client, senza
      ricaricamento). Poi cancella tutto;
    — `scripts/_spiega_registro.mjs` spiega con `EXPLAIN ANALYZE` dove vanno i
      millisecondi della lettura del Registro, **impersonando l'utente
      collegato** (ruolo `authenticated` + claims del JWT): da amministratore di
      database le policy non si applicano e la misura sarebbe falsa.
    Cosa dicevano i numeri: il database era innocente (15 MB, query media
    **1,67 ms**); l'unico spreco vero era la lettura del Registro, **20,79 ms su
    272 righe** — non per i dati, ma perché la policy `(is_admin() OR
    is_member_of(polo_id))` chiamava `is_admin()` **per ogni riga** (~540
    chiamate a funzione per apertura). In tutta l'app il tempo se ne va altrove:
    il rendering della pagina, non le interrogazioni (~4-6 per pagina; i 18 giri
    di rete che si contano per apertura includono i *prefetch* dei link, che
    Next fa in anticipo per rendere immediati i clic).
    Fatto (migrazioni `0141`, `0142`):
    — le policy si valutano **una volta** invece che per riga
      (`is_admin()` → `(select is_admin())`, `accesso_progetti()` → `(select
      accesso_progetti())`, `auth.uid()` → `(select auth.uid())`; le funzioni
      che dipendono dalla riga restano intatte). Misurato: **20,79 → 3,45 ms
      (−83%)**. La migrazione legge le espressioni dal database, applica la
      sostituzione e le riscrive: nessun permesso cambia, ed è idempotente;
      — `audit_log(at desc)` (il Registro non ordina più la tabella),
      `memberships(polo_id, user_id)` e le 38 chiavi esterne senza indice (che a
      15 MB non si sentono: sono per quando l'archivio crescerà).
    Da sapere, perché è stato visto durante la misura: sulle pagine del Registro
    il browser segnalava **errore React #418** (idratazione) su 4 pagine su 8. La
    causa era la formattazione delle date: il server sta su UTC e il browser
    sull'ora italiana, quindi `toLocaleString("it-IT")` senza fuso dichiarato
    produceva due testi diversi — React buttava via il disegno del server e
    rifaceva l'albero. In locale non si vedeva (server e browser nello stesso
    fuso), per questo era sfuggito. Corretto con un formattatore unico,
    `src/lib/data-ora.ts`, che dichiara `timeZone: "Europe/Rome"`: **73
    formattazioni in 31 file**. Non era solo una questione di velocità: email,
    verbali PDF e pagine disegnate dal server scrivevano l'ora di Greenwich —
    documenti con valore legale sbagliati di due ore. Verificato in produzione:
    nessun errore in console.
    Per calibrare i lavori futuri, la misura distingue due cose che sembrano la
    stessa e non lo sono: aprire il gestionale **da zero** (o ricaricare con F5)
    costa 500-1800 ms, mentre **cliccare dentro l'app** costa **15-54 ms** — è
    l'esperienza normale, e non c'è niente da guadagnare lì.
    Prossimo passo (non fatto): il Registro carica **23 interrogazioni e disegna
    23 sezioni** per mostrarne una — la sezione scelta dovrebbe passare
    nell'indirizzo (`?sezione=`), così il server carica e disegna solo quella.
    È l'unico posto dove restano centinaia di millisecondi da guadagnare
    sull'apertura.
    Le policy dello storage restano da consolidare (8 di lettura, 6 di
    inserimento, 5 di cancellazione per lo stesso comando, tutte in OR): non si
    sente oggi con 63 file, e conviene farlo insieme alla fase sicurezza, che
    tocca le stesse righe.

## 11. Il limite dichiarato

Chi possiede le credenziali del progetto Supabase è proprietario delle tabelle e
può, con una connessione diretta, disabilitare i trigger. Nessuno schema può
impedirlo dall'interno.

Ciò che questo impianto garantisce è che **il percorso applicativo non lo
consente mai**, che una manomissione rompe la catena di impronte in modo
rilevabile, e soprattutto che per i contenuti pubblicabili **esiste una copia
certificata fuori dal database**: nella cassetta PEC e nelle caselle di chi
partecipa. È la PEC a chiudere il cerchio — il database può anche essere
manomesso, il messaggio già spedito no.
