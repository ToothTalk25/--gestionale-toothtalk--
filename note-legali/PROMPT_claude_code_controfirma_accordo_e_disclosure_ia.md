# Prompt per Claude Code — controfirma tracciata dell'Accordo + disclosure IA

## Contesto generale

Oggi il flusso dell'Accordo Editoriale si ferma a metà: il Collaboratore carica il
PDF firmato, il gestionale lo certifica via PEC con l'impronta SHA-256 verso il
Titolare, e con un click ("Approva accordo" in `AccordiDaApprovare.tsx`) il Titolare
sblocca l'accesso e genera il Modulo di Nomina (Documento 4). Nessuna traccia esiste
del fatto che l'Accordo richiede **due firme**: il Titolare stampa la copia ricevuta,
la firma a mano, ne tiene una copia cartacea controfirmata — ma questo passaggio è
oggi interamente fuori dal gestionale, non tracciato, non richiesto da nessuna
condizione di sblocco.

Nessun collaboratore sta usando il gestionale oggi: questa modifica non ha utenti
esistenti da salvaguardare, si applica pulita fin da subito, senza casi speciali.

## Parte A — Disclosure GDPR sulla verifica IA (da fare comunque)

`src/lib/informativa-privacy.ts` menziona già che il PDF dell'accordo caricato viene
inviato a Google (API Gemini) per la verifica automatica, ma non dice al
Collaboratore che ha diritto a ottenere una revisione umana invece che affidarsi solo
all'esito automatico (rilevante per l'art. 22 GDPR, decisioni basate unicamente su
trattamento automatizzato).

Aggiungi, nella sezione "Finalità e base giuridica" o in un punto dedicato subito
dopo, una frase che dichiari esplicitamente: l'esito della verifica IA non è mai
l'unico elemento che decide l'accesso — la decisione finale è sempre e comunque
umana (l'approvazione manuale del Titolare, ora ulteriormente rafforzata dalla
controfirma tracciata di cui alla Parte B) — e che il Collaboratore ha diritto a
chiedere in qualsiasi momento che il proprio accordo sia verificato solo manualmente,
scrivendo al Titolare ai recapiti indicati.

Non è richiesto in questo giro un meccanismo di opt-out tecnico (una checkbox che
salti la chiamata a Gemini): resta un'estensione da valutare in un secondo momento,
se richiesta esplicitamente. Qui serve solo il testo corretto.

## Parte B — Controfirma tracciata dell'Accordo

### Nuova migrazione

Aggiungi a `profiles` (segui lo stile delle migrazioni esistenti, es. `0111_rinnovo_accordo.sql`):
- `accordo_controfirmato_path text`
- `accordo_controfirmato_sha256 text`
- `accordo_controfirmato_caricato_at timestamptz`
- `accordo_controfirma_confermata_at timestamptz`

Estendi `fn_protect_profile()` (stesso pattern delle altre colonne accordo in
`0103_protect_profile_accordo_anagrafica.sql`): questi quattro campi scrivibili solo
da admin/service_role, mai dal client direttamente.

### Nuovo ordine del flusso (sostituisce l'attuale "Approva accordo")

1. **Titolare carica la controfirma** (nuova azione, es.
   `caricaControfirmaAccordo(userId, storagePath, sha256)`, admin-only): sostituisce
   il bottone "Approva accordo" in `AccordiDaApprovare.tsx` con un upload del file
   scansionato intero (non solo un'impronta — l'intera scansione della copia
   cartacea controfirmata). L'azione:
   - richiede che l'accordo del collaboratore sia già caricato e verificato (stesse
     precondizioni di oggi);
   - salva `accordo_approvato_admin_at`, `accordo_approvato_da` (comportamento
     attuale di `approvaAccordoManualmente`, che questa azione sostituisce);
   - scarica il file caricato, ricalcola l'hash server-side (mai fidarsi di quello
     dichiarato dal client — stesso principio di `caricaAccordo`), salva
     `accordo_controfirmato_path`, `accordo_controfirmato_sha256`,
     `accordo_controfirmato_caricato_at`;
   - invia una PEC al Collaboratore con il documento controfirmato allegato,
     riusando `spedisciPec()` da `src/lib/pec.ts` con `destinatari` impostato sul
     contatto del collaboratore (`profile.pec` se presente, altrimenti la sua email)
     e `copiaConoscenza` verso l'accesso globale — stesso schema già usato al
     contrario in `caricaAccordo` (righe ~1072-1118 di `actions-profilo.ts`), solo
     con mittente e destinatario invertiti;
   - **NON genera ancora il Modulo di Nomina**: quello resta legato solo alla
     conferma del collaboratore, punto successivo;
   - traccia in `audit_log` (`action: "controfirma_accordo_caricata"`).

2. **Collaboratore vede e conferma** (nuova sezione in `ProfiloPersonale.tsx`,
   visibile quando `accordo_controfirmato_path` è valorizzato ma
   `accordo_controfirma_confermata_at` non lo è ancora): mostra data di caricamento,
   link per scaricare il documento controfirmato, e un bottone "Confermo che è lo
   stesso documento che ho firmato" che chiama una nuova azione
   `confermaControfirmaAccordo()`. Questa azione:
   - verifica che `accordo_controfirmato_path` esista e che la conferma non sia già
     stata data;
   - imposta `accordo_controfirma_confermata_at`;
   - **a questo punto, e solo a questo punto, genera il Modulo di Nomina**
     (`generaModuloNomina`, la stessa funzione già esistente, semplicemente chiamata
     da qui invece che dall'approvazione);
   - invia una comunicazione al Titolare (email o PEC, a scelta tua in fase di
     implementazione — basta che sia un messaggio in arrivo, non solo una riga in
     una lista admin) che informa che il Collaboratore ha confermato, con data e ora;
   - traccia in `audit_log` (`action: "controfirma_accordo_confermata"`).

### Blocco delle modifiche dopo la conferma

`aggiornaAnagrafica()` (`actions-profilo.ts:766`) oggi permette di cambiare
`codice_fiscale`, `data_nascita`, `luogo_nascita` in qualsiasi momento — nessun
controllo lo impedisce, il trigger del database protegge solo dagli accessi diretti
che bypassano la funzione, non dalla funzione stessa. Aggiungi: se
`profile.accordo_controfirma_confermata_at` è valorizzato, rifiuta modifiche a questi
tre campi (errore chiaro: "Questi dati sono bloccati dopo la conferma reciproca
dell'accordo controfirmato; contatta il Titolare per una correzione."), a meno che il
chiamante non sia admin. Stesso principio per il ricaricamento dell'accordo
(`caricaAccordo`): se `accordo_controfirma_confermata_at` è già valorizzato,
rifiuta un nuovo caricamento con lo stesso messaggio.

### Gate di accesso

`src/app/(app)/layout.tsx`, righe 32-37: aggiungi una quinta condizione ad
`accordoCompleto`: `!!profile.accordo_controfirma_confermata_at`. Senza, l'accesso
resta bloccato su `/profilo` anche con le quattro condizioni attuali soddisfatte.

### Interfaccia

- `AccordiDaApprovare.tsx`: il bottone "Approva accordo" diventa un upload file (con
  lo stesso pattern di caricamento usato in `ProfiloPersonale.tsx` per l'accordo:
  hash calcolato client-side per riferimento, upload su storage, poi chiamata alla
  server action). Aggiorna il messaggio di esito per riflettere che l'accesso non si
  sblocca ancora del tutto: manca la conferma del collaboratore.
- `ProfiloPersonale.tsx`: aggiungi la sezione di conferma descritta sopra; aggiorna
  il checklist "Accesso ai progetti — stato" (righe 536-577) da 4 a 5 voci.

## Verifica richiesta

1. Migrazione applicata, `fn_protect_profile` aggiornato, verificato che un utente
   normale non possa scrivere i 4 nuovi campi via client diretto.
2. Giro end-to-end di prova (progetto Frankfurt): un profilo di test carica
   l'accordo → tu carichi la controfirma (verifica che arrivi la PEC al contatto del
   collaboratore, non solo all'accesso globale) → verifica che il Modulo di Nomina
   NON esista ancora → il collaboratore conferma → verifica che il Modulo di Nomina
   venga generato solo ora, che l'accesso si sblocchi, e che una comunicazione
   arrivi al Titolare.
3. Verifica che dopo la conferma, un tentativo di `aggiornaAnagrafica` sui tre campi
   bloccati e un tentativo di ricaricare l'accordo vengano entrambi rifiutati con
   messaggio chiaro (non un errore grezzo).
4. `npx tsc --noEmit` e `npm run build` puliti.
5. Rendering di `/privacy`: conferma visiva del nuovo testo sulla revisione umana.

Non committare né pushare senza il mio ok esplicito.
