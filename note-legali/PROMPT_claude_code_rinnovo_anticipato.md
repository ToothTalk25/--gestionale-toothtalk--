# Prompt per Claude Code — permettere il rinnovo prima della scadenza

## Contesto

Ho verificato il lavoro appena fatto sul rinnovo a 6 mesi (migrazioni 0111/0112,
`caricaRinnovoAccordo`/`approvaRinnovoAccordo`, `/rinnovo`, `RinnoviDaApprovare.tsx`): la
struttura è corretta, `tsc` pulito, nulla di committato. Un solo problema di design, mio,
non tuo: così com'è, l'unico punto da cui si carica il rinnovo è `/rinnovo`, e ci si arriva
SOLO dopo che `accordo_scadenza` è già passata (vedi `src/app/(app)/layout.tsx`, righe
~42-52, `accordoScaduto`). Questo significa che ogni singolo Collaboratore, ad ogni ciclo di
6 mesi, viene bloccato per forza almeno per il tempo che impiega a caricare il rinnovo e ad
attendere la mia approvazione — anche se vuole rinnovare con giorni o settimane di anticipo.
Non c'è nessuna ragione legale per questo: l'Art. 9.1 dell'Accordo non impone che il rinnovo
avvenga solo a scadenza avvenuta, dice solo che senza rinnovo il rapporto cessa "alla
naturale scadenza".

## Cosa cambiare

Il rinnovo deve poter essere caricato in qualsiasi momento, non solo dopo il blocco.

1. **`caricaRinnovoAccordo`** (`src/app/actions-profilo.ts`): nessuna modifica di logica
   necessaria — già non controlla `accordo_scadenza`, quindi funziona già se richiamata
   prima della scadenza. Verifica solo che non ci siano guardie implicite che lo impediscano
   (es. controlli lato route che assumono che ci si arrivi solo da `/rinnovo`).

2. **Un punto di accesso raggiungibile anche PRIMA della scadenza.** Il modo più semplice:
   in `/profilo` (dove il Collaboratore già gestisce l'accordo iniziale), aggiungere una
   sezione "Rinnovo" sempre visibile per chi ha `accordo_approvato_admin_at` non nullo — con
   lo stesso componente di upload già scritto per `/rinnovo` (`RinnovoAccordo.tsx`,
   riutilizzalo o estraine la parte di upload in un componente condiviso). Mostra la
   scadenza attuale (`accordo_scadenza`) e permette il caricamento in ogni momento, non solo
   a ridosso o dopo.

3. **`/rinnovo` resta**, ma diventa la destinazione obbligata SOLO per chi è già scaduto
   (il redirect di `layout.tsx` non cambia) — per chi rinnova in anticipo da `/profilo`,
   nessun redirect forzato, resta libero di usare il resto del gestionale nell'attesa
   dell'approvazione.

4. **Se il rinnovo viene caricato E approvato prima della scadenza**, `approvaRinnovoAccordo`
   deve comunque spostare `accordo_scadenza` a `+6 mesi da now()` (comportamento già
   presente, non da cambiare) — non da "+6 mesi dalla vecchia scadenza". Non serve quindi
   nessuna logica di "somma" tra periodi: chi rinnova un mese prima perde quel mese, è
   accettabile e coerente con l'assenza di preavviso richiesta esplicitamente in questa
   prima versione.

## Cosa NON fare

- Non toccare le migrazioni 0111/0112, sono corrette così.
- Non aggiungere PEC al rinnovo: l'Art. 15 dell'Accordo (che l'Art. 9.1 richiama come
  "stessa procedura") non la nomina — l'ho riletto nel testo del documento, parla solo di
  firma, caricamento, hash, registro, approvazione. Il rinnovo la replica già fedelmente.
- Non aggiungere ancora un preavviso automatico N giorni prima della scadenza — resta fuori
  scope come già indicato nel prompt precedente, a meno che non te lo chieda separatamente.

## Anche da fare, cosmetico ma utile

Aggiungi in `/profilo` una riga di trasparenza con la data di `accordo_scadenza` (es. "Il
tuo Accordo scade il [data]"), visibile sempre, non solo nella sezione di rinnovo — diventa
più utile ora che il rinnovo anticipato è permesso, perché la persona può decidere di
muoversi prima senza aspettare il blocco.

## Altro, indipendente da questo prompt

- `admin@toothtalk.local` esiste solo in `scripts/_e2e_rinnovo.mjs` (fixture di test), non in
  codice o migrazioni di produzione: rimuovilo dal DB di test dopo l'ultima run, non è un
  problema per il deploy.
- Il backfill retroattivo su `accordo_scadenza` per i profili già approvati (0111) è corretto
  così, confermato.

## Verifica prima di commit/deploy

- Un Collaboratore con accordo approvato e `accordo_scadenza` futura può caricare e vedere
  approvato un rinnovo da `/profilo` SENZA mai passare da `/rinnovo` e senza perdere
  l'accesso al resto del gestionale nel frattempo.
- Un Collaboratore già scaduto continua a essere reindirizzato a `/rinnovo` come oggi.
- `tsc` pulito, build ok.

Le modifiche non sono committate: fammi sapere l'esito prima di committare e fare il deploy.
