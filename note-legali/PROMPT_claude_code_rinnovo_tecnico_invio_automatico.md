# Prompt per Claude Code — rinnovo del Collaboratore Tecnico con invio automatico dal gestionale

## Contesto

Sono stati redatti due nuovi documenti (fuori dal gestionale, in attesa di revisione legale finale di
Enrico prima dell'uso):

- `DOCUMENTO 5 - ACCORDO COLLABORATORE TECNICO (BOZZA).docx` — l'accordo per chi contribuisce come
  informatico/automazioni (gestionale + Make.com): limiti di accesso ai sistemi (Art. 4 + Allegato 1),
  cessione IP del codice (Art. 5), riservatezza estesa a credenziali/architettura (Art. 6), nomina GDPR
  art. 29 (Art. 8), clausola anti-sabotaggio con riferimento esplicito agli artt. 629 e 615-ter/635-bis/
  635-quater c.p. e penale ex art. 1382 c.c. (Art. 9), durata 6 mesi rinnovabile + recesso libero in
  qualsiasi momento (Art. 11).
- `DOCUMENTO 5bis - RINNOVO ACCORDO COLLABORATORE TECNICO (BOZZA).docx` — la dichiarazione di rinnovo
  che il Collaboratore Tecnico firma e carica alla scadenza del semestre. Contiene un campo dedicato,
  ben visibile subito sotto l'identificazione delle parti: "Impronta digitale (hash SHA-256) del
  documento dell'Accordo, come registrata dal gestionale al momento del caricamento originale". Questo
  campo è il punto di aggancio legale tra i due documenti: senza un'identificazione univoca del testo
  esatto sottoscritto la prima volta, un rinnovo che si limita a citare una data è debole in caso di
  contestazione ("ho firmato una versione diversa"). Il testo del rinnovo qualifica esplicitamente
  l'atto come mera proroga e non come novazione ex art. 1230 c.c., proprio per non interrompere le
  obbligazioni post-contrattuali dell'Accordo (riservatezza 5 anni, cessione IP, divieto di sabotaggio
  "anche successivamente alla cessazione").

Enrico vuole che, quando il Collaboratore Tecnico richiede il rinnovo e lui lo approva, il gestionale
mandi da solo il documento approvato al Collaboratore (PEC o email), come già avviene per la
controfirma (`caricaControfirmaAccordo`, Parte B del prompt controfirma) — non solo aggiornare un campo
in silenzio come fa oggi `approvaRinnovoAccordo()` per i Collaboratori editoriali.

## Decisione da prendere PRIMA di scrivere codice — chiedi a Enrico se non è ovvio dal contesto

Il Collaboratore Tecnico oggi non esiste nel modello dati: `profiles.role` non ha un valore per lui, e
tutto il flusso accordo/rinnovo/verifica-IA (`caricaAccordo`, `approvaAccordoManualmente`,
`caricaRinnovoAccordo`, `approvaRinnovoAccordo`, la verifica Gemini) è scritto assumendo un unico
modello di accordo (Documento 1). Due strade, non equivalenti in costo:

- **Opzione A — integrazione piena.** Nuovo valore di `role` (es. `'tecnico'`), il Collaboratore Tecnico
  ha un profilo vero nel gestionale, si registra, carica l'accordo, passa dalla verifica IA, ha una sua
  scadenza e un suo rinnovo. Corretta se in futuro ci saranno più collaboratori tecnici, ma tocca la
  verifica IA (deve sapere confrontare l'upload con DOCUMENTO 5, non con Documento 1), l'accesso alle
  pagine `(app)` (quali poli/progetti vede un ruolo che non produce contenuti?), e ogni punto che oggi
  assume implicitamente "ogni Collaboratore = accordo editoriale".
- **Opzione B — flusso minimo, solo per il rinnovo.** Il Collaboratore Tecnico non ha un profilo
  `(app)`: l'accordo iniziale si firma e si scambia fuori dal gestionale (PEC/email dirette, come oggi
  per qualunque accordo non ancora digitalizzato). Il gestionale interviene solo per questo: una pagina
  o azione admin-only dove Enrico registra il nome/contatto del Collaboratore Tecnico e la data di
  scadenza corrente; quando arriva la richiesta di rinnovo (fuori gestionale, es. email), Enrico carica
  il documento di rinnovo firmato in una sezione dedicata e approva; il sistema manda la PEC/email con
  l'allegato e sposta la scadenza di 6 mesi, riusando `spedisciPec()` da `src/lib/pec.ts` come fa già
  `caricaControfirmaAccordo`. Molto meno lavoro, non tocca il modello `profiles`/`role` né la verifica
  IA, ma non dà al Collaboratore Tecnico un'area riservata per caricare da sé i documenti.

**Raccomandazione:** finché il Collaboratore Tecnico è uno solo, Opzione B — meno superficie, meno
rischio di rompere il flusso esistente per i Collaboratori editoriali. Passare a Opzione A solo se e
quando il ruolo si moltiplica. Non partire a scrivere migrazioni sul modello `profiles` senza che Enrico
abbia confermato quale delle due vuole.

## Implementazione (assumendo Opzione B, da adattare se Enrico sceglie A)

1. **Nuova tabella minima** `collaboratori_tecnici` (o estensione leggera, non su `profiles`): id,
   nome, email/pec di contatto, `accordo_path text`, `accordo_sha256 text` (l'impronta del DOCUMENTO 5
   firmato la prima volta — quella che finisce stampata sul Documento 5bis ad ogni rinnovo),
   `accordo_scadenza date`, `rinnovo_path text`, `rinnovo_sha256 text` (impronta del Documento 5bis
   stesso, distinta da `accordo_sha256`), `rinnovo_caricato_at timestamptz`,
   `rinnovo_approvato_admin_at timestamptz`, `rinnovo_approvato_da uuid references profiles(id)`. RLS:
   leggibile/scrivibile solo da admin — nessun utente applicativo corrisponde a questa riga, quindi
   niente policy per "utente proprietario".
2. **Registrazione iniziale:** quando Enrico carica per la prima volta il DOCUMENTO 5 firmato dal
   Collaboratore Tecnico (fuori gestionale, Opzione B), un'azione admin-only calcola e salva
   `accordo_sha256` in questa riga — è la stessa identica operazione (ricalcolo server-side dell'hash)
   già fatta da `caricaAccordo` per l'accordo editoriale, solo su una tabella diversa.
3. **Sezione admin dedicata** (nuovo pannello o card in `/admin`), non in `AccordiDaApprovare.tsx` che
   resta specifico dell'accordo editoriale: elenco dei Collaboratori Tecnici con scadenza e, ben
   visibile, l'`accordo_sha256` registrato — Enrico lo copia sul Documento 5bis (a mano o, se si vuole
   fare un passo oltre, con generazione automatica del PDF di rinnovo già precompilato con quel valore)
   prima di farlo firmare al Collaboratore. Poi upload del documento di rinnovo firmato e bottone
   "Approva rinnovo".
4. **Azione `approvaRinnovoTecnico(id, storagePath, sha256)`** (admin-only, service_role): ricalcola
   l'hash del rinnovo server-side (mai fidarsi di quello dichiarato — stesso principio di
   `caricaAccordo`), sposta `accordo_scadenza` di 6 mesi dalla data di approvazione, invia PEC/email al
   contatto del Collaboratore Tecnico con il documento approvato allegato riusando `spedisciPec()`
   (stesso schema di `caricaControfirmaAccordo`, righe indicate nel prompt controfirma), traccia in
   `audit_log` (`action: "rinnovo_tecnico_approvato"`).
5. **Promemoria scadenza:** riusa lo stesso principio già previsto per l'Art. 8.2 dei Collaboratori
   editoriali (notifica proattiva 30gg prima) se già implementato, o segnalalo come lavoro futuro se non
   lo è ancora — non bloccante per questo giro.

## Verifica richiesta

1. Migrazione applicata, RLS verificata (un utente non-admin non deve poter leggere né scrivere la
   nuova tabella).
2. Giro di prova end-to-end (progetto Frankfurt): Enrico registra un accordo tecnico di test (verifica
   che `accordo_sha256` venga salvato e mostrato in chiaro nel pannello admin), carica un rinnovo di
   test con quel valore riportato sul documento, lo approva, verifica che la PEC/email arrivi con
   l'allegato corretto e che `accordo_scadenza` si sposti di 6 mesi esatti dalla data di approvazione
   (non dalla vecchia scadenza, salvo che Enrico non preferisca il calcolo dalla vecchia scadenza per
   evitare di "perdere" giorni in caso di approvazione tardiva — da chiarire con lui, replica la stessa
   scelta già fatta per `fn_accordo_scadenza`).
3. Verifica specifica sull'hash: l'`accordo_sha256` mostrato a Enrico per un dato Collaboratore Tecnico
   deve corrispondere esattamente all'hash ricalcolato dal file salvato in storage per quel collaboratore
   — un disallineamento qui vanificherebbe l'intero scopo dell'aggancio legale descritto nel Contesto.
4. `npx tsc --noEmit` e `npm run build` puliti.

Non committare né pushare senza il mio ok esplicito.
