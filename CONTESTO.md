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

Chi ha `role = 'admin'` ha accesso trasversale a tutti i gruppi. Non compare
nessuna etichetta accanto al nome: la differenza si vede solo dalle voci di menu
disponibili.

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

**Migrazioni.** Da `0001` a `0017` sono già state applicate al database reale.
**Non modificarle**: file e database divergerebbero. Per cambiare qualcosa si
aggiunge un file nuovo (`0018_...sql`) e si lancia `npm run migra -- 0018`.

I file che aggiungono valori a un enum (`0005`, `0010`, `0012`) vanno eseguiti
**da soli**: Postgres non permette di usare un valore di enum nella stessa
transazione in cui è stato creato.

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

## 10. Cosa manca

1. **Credenziali PEC** in `.env.local` (`PEC_USER`, `PEC_PASSWORD`,
   `PEC_MITTENTE`, `PEC_DESTINATARI`). Host e limite sono già impostati su Poste.
2. **Account dei partecipanti** — `npm run utente -- crea` e `-- assegna`.
3. **Pubblicazione online** (Vercel + GitHub): oggi gira solo in locale.
4. **Cancellare l'account di prova** `mario.rossi.messina@esempio.it` prima di
   andare online.

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
