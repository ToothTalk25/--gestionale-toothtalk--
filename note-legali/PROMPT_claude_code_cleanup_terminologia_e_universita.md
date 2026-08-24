Contesto: audit di Enrico sull'informativa privacy del gestionale, letta
per intero e commentata con screenshot. Alcuni punti sono chiusi da parte
mia (documenti/testo), altri richiedono modifiche al codice. Questo
prompt copre solo i punti codice, confermati e decisi. Trattali come
commit separati e indipendenti — non è un blocco unico.

## Commit 1 — terminologia: Titolare / Coordinatore / referente

Enrico usa tre nomi diversi per la stessa persona (se stesso) in punti
diversi del gestionale, e questo genera confusione su chi sia chi.
Regola decisa: **"Titolare del trattamento" solo dove il GDPR impone
quel termine esatto** (definizione del ruolo, ed esercizio dei diritti
"nei confronti del Titolare del trattamento" — è terminologia di legge,
non va cambiata). **In ogni altro punto, usa "Coordinatore"** — mai
"referente", che va eliminato.

In `src/lib/informativa-privacy.ts`, riga 62, ci sono le uniche due
occorrenze di "referente" nel codice:

```
"L'anagrafica completa è visibile solo a te e al referente del progetto.
Gli altri partecipanti del gruppo vedono solo il tuo nome. I materiali
depositati sono visibili ai partecipanti del tuo gruppo e al referente."
```

Sostituisci entrambe con "Coordinatore". Le occorrenze di "Titolare del
trattamento" alle righe 19, 20 e 65 restano invariate (contesto GDPR
corretto).

## Commit 2 — pagina Informativa: il link di ritorno sbaglia sempre destinazione

`src/app/privacy/page.tsx` ha sempre e solo "Torna al login" in fondo,
anche quando la pagina viene aperta dal gestionale dopo il login (link
in `src/app/(app)/layout.tsx`, riga ~105). Chi la apre da dentro il
gestionale finisce sbattuto al login invece di tornare dove stava.

Aggiungi un parametro (es. `?from=app`) al link in `(app)/layout.tsx`,
e in `privacy/page.tsx` leggi `searchParams` per decidere il testo/target
del link finale: se `from=app`, mostra "Torna al gestionale" verso la
route home autenticata (verifica tu qual è, es. `/dashboard`); altrimenti
lascia "Torna al login" com'è ora, per tutti gli altri punti di ingresso
(login, registrazione, termini, carica-liberatoria — quest'ultimo è un
terzo non autenticato, lì "torna al login" non ha senso ma non è materia
di questo fix, è preesistente).

Nota aggiuntiva di Enrico, separata dal bug ma stesso contesto: valuta se
aggiungere un'opzione "ricorda l'accesso" alla sessione (session più
lunga lato Supabase Auth) per non dover rifare login continuamente. Non è
urgente quanto il bug sopra — implementala solo se è una modifica
contenuta della configurazione di sessione esistente, altrimenti
segnalamelo come task a parte.

## Commit 3 — mai "contratto" per l'Accordo Editoriale

L'Accordo non è un contratto in senso tecnico (nessun rapporto di lavoro,
nessuna obbligazione patrimoniale — l'intera architettura del Progetto è
costruita per evitare quella qualificazione, vedi art. 2.3 dell'Accordo).
In `src/lib/informativa-privacy.ts`, righe 42-43, "contratto" è usato per
nominare la base giuridica GDPR:

```
"Esecuzione del contratto (art. 6.1.b GDPR): ..."
"Obbligo connesso all'esecuzione del contratto (art. 6.1.b GDPR): ..."
```

Sostituisci "contratto" con "accordo" in entrambe (mantieni la citazione
"art. 6.1.b GDPR" invariata: è il numero dell'articolo che conta, non la
parola usata per descriverlo). Non toccare invece: "clausole contrattuali
standard (SCC)" alla riga 52 (nome tecnico del meccanismo di trasferimento
extra-UE, corretto così) e "concludere contratti" nell'Accordo Art. 14.1
(riferito a contratti che il Collaboratore NON può concludere per conto
del Progetto — uso corretto, diverso contesto).

## Commit 4 — spiega "append-only" in linguaggio comune

Riga 55 e 56 di `informativa-privacy.ts` usano "registro append-only"
senza spiegarlo. Aggiungi una breve spiegazione alla prima occorrenza
(riga 55), qualcosa come: "append-only: un registro a cui si può solo
aggiungere, mai modificare o cancellare righe già scritte". Non serve
ripeterla alla riga 56, basta che la prima la definisca chiaramente.

## Commit 5 — rimozione strutturale dei riferimenti alle università

Decisione di Enrico: nessuna associazione, nemmeno implicita, tra il
Progetto e specifiche università nel gestionale. Motivo: rischio di
un'associazione percepita come "parassitaria" del marchio universitario,
e valutazione in corso se proporre invece un rapporto formale alle
università in futuro — nel frattempo, va tenuto fuori da tutto ciò che è
strutturale.

Cosa ho già verificato io sul codice, così non parti da zero:

- **L'assegnazione al polo non dipende dall'università**: in
  `src/app/actions-invito.ts`, `verifica.dati.polo_id` viene già risolto
  dal codice invito, non dal dominio della PEC. Il controllo
  `pec_universitaria_valida` (righe ~93-108) è un controllo *secondario e
  opzionale* — gira solo se l'utente fornisce una PEC — e nonostante il
  nome **non verifica più da tempo l'appartenenza a un ateneo**: la
  funzione SQL (`0031_pec_non_universitaria.sql`) scarta solo i domini di
  posta gratuita più diffusi (Gmail, Outlook, ecc.), qualunque altro
  dominio passa. Il commento della funzione lo dice esplicitamente. Puoi
  rimuovere questo controllo senza impatto sull'assegnazione al polo.

  **Prima di rimuoverlo però risolvi il problema reale che c'è ora**: il
  messaggio d'errore mostrato all'utente mente su cosa viene verificato —
  dice "La PEC non appartiene al dominio universitario del gruppo. Usa la
  PEC rilasciata dal tuo ateneo..." quando in realtà il controllo non
  c'entra nulla con l'ateneo, controlla solo che non sia una casella di
  posta gratuita. Che tu decida di tenere il controllo (con messaggio
  corretto, tipo "Usa una PEC vera, non un indirizzo email gratuito come
  Gmail o Outlook") o di toglierlo del tutto, il messaggio attuale va
  comunque cambiato: è falso indipendentemente da questa richiesta.

- **Le etichette "Gruppo universitario"** compaiono in 4 punti:
  `src/app/(app)/task/[taskId]/certificato/[versionId]/page.tsx` (riga
  79), `src/app/(app)/task/[taskId]/verbale/[pacchettoId]/page.tsx`
  (riga 58), `src/app/layout.tsx` (riga 18, meta description), e
  `src/lib/informativa-privacy.ts` (riga 42, "organizzare la
  partecipazione dei gruppi universitari"). Rinominale in "Polo" (o
  altro termine neutro a tua scelta, purché coerente con come il resto
  del gestionale chiama già la stessa entità — il modello dati sotto
  usa già `polo`/`poli`, quindi "Polo" è la scelta più coerente e con
  minor rischio di incoerenza).

- **Il campo "Università" nell'anagrafica** (`profiles.universita`,
  self-report libero, non collegato al `polo`) va tolto dal form profilo
  (`src/components/ProfiloPersonale.tsx`, righe ~245-256, incluso il
  testo di aiuto "Studenti e studentesse di odontoiatria: l'università
  basta a identificarvi") e dalla lista "dati anagrafici essenziali" in
  `informativa-privacy.ts`. Non toccare la colonna del database in questo
  commit — se ci sono già righe valorizzate, decidi tu se conviene una
  migrazione di pulizia separata o lasciarla inerte; non è materia di
  questo prompt.

- **Altri file che citano "università"** (trovati con una ricerca, non
  ancora verificati uno per uno): `src/lib/types.ts`,
  `src/app/(app)/admin/page.tsx`, `src/components/ProfiliUscenti.tsx`,
  `src/lib/auth.ts`, `src/components/RichiesteRegistrazione.tsx`. Prima
  di modificare, ricontrolla tu ognuno con lo stesso criterio: se è
  un'etichetta o un campo che espone/richiede l'affiliazione universitaria
  in modo strutturale, va tolto o rinominato; se è codice tecnico
  ininfluente (nome di variabile interna, tipo, colonna DB non esposta),
  non serve toccarlo.

### Cosa NON è compreso in questo commit

I due documenti .docx che ho già verificato e lasciato invariati
(Accordo Editoriale, artt. 2.4 e 3.1) menzionano "studente universitario"
e "professori universitari" in modo generico, senza nominare alcun
ateneo specifico — servono a escludere il riconoscimento di CFU/tirocinio
e a descrivere un possibile beneficio non economico della collaborazione.
Non li ho tolti: sono io a doverlo fare se Enrico conferma di volerli
via anche lì, non è compito tuo. Non toccare nessun file in
`public/documenti/`.

## Test

Dopo i 5 commit: nessuna label "Gruppo universitario" residua, nessun
"referente" residuo, nessuna menzione di "contratto" per l'Accordo nelle
due righe indicate, il link di ritorno dalla pagina privacy porta al
gestionale se aperta da lì, "append-only" è spiegato al primo utilizzo,
e il form profilo non chiede più l'università.
