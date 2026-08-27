# Prompt per Claude Code — scadenza a 6 mesi dell'Accordo, blocco e rinnovo

## Contesto

Ho appena riscritto l'Art. 9.1 dell'Accordo Editoriale per riflettere un meccanismo che
oggi NON esiste nel gestionale — l'ho fatto su istruzione esplicita di Enrico, quindi il
documento adesso descrive questa funzionalità come se fosse operativa. Finché questo
prompt non è eseguito e verificato, Accordo (Art. 9.1) e codice sono disallineati: è
importante costruirlo prima possibile.

Testo attuale dell'Art. 9.1 (per riferimento esatto):

> "9.1. Il presente accordo ha durata fissa di 6 (sei) mesi a decorrere dalla data di
> sottoscrizione, rinnovabile per ulteriori periodi di 6 (sei) mesi mediante un documento
> di rinnovo, sottoscritto e caricato sul gestionale secondo la stessa procedura prevista
> per il presente Accordo (Art. 15), e approvato dal Coordinatore. Alla naturale scadenza
> del termine, il gestionale sospende l'accesso del Collaboratore con apposito avviso,
> salvo che il documento di rinnovo sia stato caricato e approvato prima di tale data;
> l'approvazione del Coordinatore riattiva l'accesso e fa decorrere un nuovo periodo di 6
> (sei) mesi. In assenza di rinnovo, il rapporto si intende cessato alla naturale scadenza,
> senza necessità di alcuna comunicazione."

Ho verificato prima di scrivere questo prompt: oggi `accordo_approvato_admin_at`
(`profiles`, da `0086_accordo_approvazione_admin.sql`) è un timestamp scritto una volta e
mai più ricontrollato. Non esiste nessuna scadenza calcolata, nessun blocco per tempo
trascorso, nessuna funzione di rinnovo. Il gate d'accesso in
`src/app/(app)/layout.tsx` (righe ~21-40) blocca oggi SOLO se l'accordo iniziale non è
mai stato completato (4 condizioni: caricato, "letto e compreso", verificato, approvato) —
non c'è nessun quinto controllo temporale.

## Come funziona in pratica (descritto da Enrico)

Il documento di rinnovo è un file breve (meno di una pagina) che Enrico prepara fuori dal
gestionale, il Collaboratore firma e carica con la stessa modalità già usata per l'Accordo
iniziale (scansione/foto del firmato, caricamento nel gestionale). Enrico, come
Coordinatore, lo approva dal gestionale: quell'approvazione riattiva l'accesso e sposta la
scadenza altri 6 mesi avanti.

## Cosa costruire

### 1. Schema — nuovi campi su `profiles`

Aggiungere (nuova migrazione, es. `0111_rinnovo_accordo.sql`):

- `accordo_scadenza date` — calcolato e scritto a `accordo_approvato_admin_at + interval '6 months'` nel momento dell'approvazione (sia dell'accordo iniziale sia di ogni rinnovo). Va quindi anche popolato retroattivamente per i profili già approvati (`update profiles set accordo_scadenza = accordo_approvato_admin_at::date + interval '6 months' where accordo_approvato_admin_at is not null and accordo_scadenza is null`).
- `rinnovo_path text`, `rinnovo_sha256 text`, `rinnovo_caricato_at timestamptz`, `rinnovo_approvato_admin_at timestamptz`, `rinnovo_approvato_da uuid references profiles(id)` — stesso pattern dei campi `accordo_*` esistenti, per il documento di rinnovo corrente (in attesa di approvazione). Una volta approvato, questi valori si "consolidano" nel nuovo `accordo_scadenza` e si azzerano (`rinnovo_path` torna null) per essere pronti al rinnovo successivo — non serve una tabella storica separata, la copia su Drive già fa da archivio (vedi punto 3).

Aggiornare anche il trigger `fn_protect_profile` (0103) se già protegge i campi `accordo_*` da scritture non autorizzate: i nuovi campi `rinnovo_*` vanno protetti allo stesso modo (solo admin/service_role in scrittura).

### 2. Server actions in `src/app/actions-profilo.ts` — stesso pattern di `caricaAccordo`/`approvaAccordoManualmente`

- `caricaRinnovoAccordo(storagePath, sha256Client)`: ricalca `caricaAccordo` (righe 845+) — verifica che il path stia nello spazio dell'utente, scarica il file, ricalcola l'hash server-side (mai fidarsi di quello client), scrive `rinnovo_path`/`rinnovo_sha256`/`rinnovo_caricato_at`. Non serve la spunta "ho letto e compreso" (è un rinnovo, non la prima lettura), né i controlli su data di nascita/CF (già presenti dal primo accordo). Copia di sicurezza su Drive come già fa `caricaAccordo` (stessa cartella o una `rinnovi/` accanto).
- `approvaRinnovoAccordo(userId)`: ricalca `approvaAccordoManualmente` (riga 1543+) — solo admin, richiede `rinnovo_path` non nullo, scrive `rinnovo_approvato_admin_at`/`rinnovo_approvato_da`, e soprattutto aggiorna `accordo_scadenza = now() + interval '6 months'`. Traccia nell'`audit_log` come le altre azioni analoghe (action tipo `"approvazione_rinnovo_accordo"`). Non serve rigenerare il Modulo di nomina (Documento 4): quello resta valido, non è legato alla scadenza dei 6 mesi.

### 3. Gate d'accesso — `src/app/(app)/layout.tsx`

Aggiungere un quinto stato, distinto dal blocco esistente (che resta per chi non ha MAI completato l'accordo): se `accordo_scadenza` è passata E non c'è un rinnovo approvato più recente, reindirizzare a una pagina dedicata (es. `/rinnovo`, fuori da questo gruppo di rotte come già fa `/uscita` per la conferma Art. 9.4) con un avviso chiaro tipo "Il tuo Accordo Editoriale è scaduto il [data]: carica il documento di rinnovo per riattivare l'accesso" e la stessa UI di upload già usata per l'accordo iniziale (riadattata per `caricaRinnovoAccordo`). L'admin non è mai soggetto a questo blocco (come già oggi per il blocco esistente).

Attenzione a non creare loop: chi è in stato "scaduto, in attesa di rinnovo" deve poter restare SOLO sulla pagina di rinnovo, esattamente come oggi chi non ha completato l'accordo iniziale resta solo su `/profilo`.

### 4. UI admin

Nel pannello dove oggi si approva l'accordo iniziale (verificare dove vive quella UI —
probabilmente `/admin`), aggiungere la stessa azione per i rinnovi in attesa: mostrare chi
ha caricato un `rinnovo_path` non ancora approvato, con bottone che chiama
`approvaRinnovoAccordo`.

## Cosa NON fare

- Non toccare `caricaAccordo`/`approvaAccordoManualmente`: restano intatte per il primo
  accordo. I rinnovi sono funzioni nuove e parallele, non una modifica di quelle esistenti.
- Non rigenerare il Modulo di nomina al rinnovo (vedi punto 2).
- Non serve una notifica proattiva prima della scadenza in questa prima versione — Enrico
  ha descritto solo il blocco al momento della scadenza, non un preavviso. Se vorrà un
  avviso N giorni prima (come già esiste per la revoca Art. 8.2), sarà un prompt separato.

## Verifica prima di commit/deploy

- Migrazione applicata su un ambiente di test prima che su produzione: verificare che
  `accordo_scadenza` si popoli correttamente sui profili già approvati.
- Test end-to-end: profilo con `accordo_scadenza` nel passato → verificare redirect a
  `/rinnovo` e blocco del resto dell'app; caricamento rinnovo → approvazione admin →
  verificare che l'accesso torni libero e `accordo_scadenza` sia spostata di 6 mesi da ora.
- `tsc` pulito, build ok.

Le modifiche non sono committate: fammi sapere l'esito prima di committare e fare il deploy.
