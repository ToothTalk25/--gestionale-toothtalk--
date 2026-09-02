# Prompt per Claude Code — due modifiche indipendenti, da chiudere insieme

Due task scollegati tra loro, ognuno piccolo: falli entrambi, ma non mescolarli in un
unico commit — sono due commit separati con due messaggi separati (vedi in fondo).

---

## Task 1 — bump di PRIVACY_VERSION

`src/lib/types.ts` riga 4: `export const PRIVACY_VERSION = "2026-08-21h";`

Il commit `ab509aa` ("docs(privacy): secondo fondamento giuridico...") ha aggiunto in
`informativa-privacy.ts` una nuova voce "Interesse legittimo" nella lista "Finalità e base
giuridica" e riscritto il paragrafo "Revoca del consenso" — testo dell'informativa
cambiato, ma `PRIVACY_VERSION` non è stata toccata (verificato: `git show ab509aa --
src/lib/types.ts` non produce diff). Va aggiornata ora, perché è quello che fa scattare
la richiesta di nuovo consenso lato utente (vedi `BannerConsenso.tsx` riga 32:
confronta `c.versione === PRIVACY_VERSION`).

Cambia la stringa in un nuovo valore, stesso pattern del valore attuale (data +
lettera progressiva per eventuali revisioni nello stesso giorno), es. `"2026-08-27a"` —
usa la data di oggi. Non serve altro: chi ha già accettato la vecchia versione vedrà
di nuovo il banner di consenso alla prossima visita, comportamento already previsto e
voluto.

Non toccare `COOKIE_VERSION`: è un valore indipendente, non c'entra con questo cambio.

## Task 2 — verifica tecnica maggiore età alla firma dell'Accordo

L'Accordo Editoriale ha un Art. 2.5: "Il Collaboratore dichiara, sotto la propria
responsabilità, di essere maggiorenne alla data di sottoscrizione del presente
accordo." È una dichiarazione — non impedisce da sola che un minorenne firmi mentendo.

Il gestionale raccoglie già `data_nascita` (colonna `date` su `public.profiles`,
da `0088_documento4_nomina_automatica.sql`) prima di poter caricare l'Accordo:
`caricaAccordo()` in `src/app/actions-profilo.ts` (riga ~845) blocca già il caricamento
se `data_nascita`, `luogo_nascita` o `codice_fiscale` mancano (righe ~871-878), ma
verifica solo la *presenza* del dato, non l'età che ne deriva.

In `caricaAccordo()`, subito dopo il controllo di presenza esistente, aggiungi un
controllo che calcoli l'età da `data_nascita` rispetto alla data odierna e blocchi il
caricamento (stesso pattern di errore già usato per i campi mancanti, stesso tono nel
messaggio) se l'età risulta inferiore a 18 anni:

```ts
const oggi = new Date();
const nascita = new Date(profile.data_nascita);
let eta = oggi.getFullYear() - nascita.getFullYear();
const meseGiorno = oggi.getMonth() - nascita.getMonth() || oggi.getDate() - nascita.getDate();
if (meseGiorno < 0) eta--;
if (eta < 18) {
  return { ok: false, errore: "La sottoscrizione dell'Accordo Editoriale è riservata a chi ha già compiuto 18 anni." };
}
```

Adatta lo stile esatto (gestione errori, tipi) a quello già usato nella funzione per il
controllo di presenza dei campi — non introdurre un pattern diverso.

### Dove NON intervenire

- Non toccare `ProfiloPersonale.tsx` lato client: il blocco server-side in
  `caricaAccordo()` basta, coerente con l'impostazione esistente (i controlli di
  presenza sono server-side, il client si limita a disabilitare il bottone in modo
  euristico).
- Non toccare `approvaAccordoManualmente()`: se `caricaAccordo()` blocca
  correttamente, un Accordo di un minorenne non arriva mai in stato "caricato" da
  approvare — un secondo controllo lì sarebbe ridondante, non difesa in profondità
  reale (stessa fonte dato, non un canale indipendente).

### Verifica prima di commit

- Test manuale: `data_nascita` che dia età 17 anni e 364 giorni → blocco; età 18 anni
  esatti (oggi compleanno) → passa.
- Non toccare la migrazione 0088 né lo schema: il campo esiste già, serve solo la
  verifica applicativa.

---

## Commit — due separati

```
feat(privacy): aggiorna PRIVACY_VERSION dopo l'aggiunta dell'interesse legittimo

PRIVACY_VERSION non era stata aggiornata nel commit ab509aa nonostante il testo
dell'informativa fosse cambiato (nuova voce "Interesse legittimo", riscrittura del
paragrafo "Revoca del consenso"). Aggiornata ora così il banner di consenso richiede
una nuova accettazione a chi aveva già confermato la versione precedente.
```

```
feat(accordo): blocco server-side per minorenni in caricaAccordo

L'Art. 2.5 dell'Accordo Editoriale dichiara che il Collaboratore è maggiorenne, ma è
una dichiarazione, non un controllo. caricaAccordo() già richiede data_nascita prima
del caricamento: ora calcola l'età e blocca se inferiore a 18 anni, con lo stesso
pattern di errore già usato per i campi anagrafici mancanti.

Non toccati: ProfiloPersonale.tsx (il blocco server-side basta),
approvaAccordoManualmente() (ridondante, stessa fonte dato).
```

Le modifiche non sono committate: fammi sapere l'esito di entrambe prima di
committare e fare il deploy.
