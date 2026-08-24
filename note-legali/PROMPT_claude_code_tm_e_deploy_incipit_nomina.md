Contesto: hai già applicato e verificato la correzione dell'incipit di
`generaModuloNomina()` (`src/app/actions-profilo.ts`) — "Il/la
Collaboratore/trice ... quale persona autorizzata..." al posto della
vecchia forma ambigua. Restavano due micro-differenze rispetto al docx
in `public/documenti/4-modulo-nomina.docx`, sulle quali ho deciso:

## Decisione 1 — maiuscola "Il/la" a inizio paragrafo

Lascia com'è. Nel gestionale "DICHIARA E NOMINA" è un titolo (`h2`)
separato, non l'inizio della stessa frase come nel docx — la maiuscola a
inizio paragrafo è corretta lì per motivi strutturali, non va allineata
al minuscolo del docx.

## Decisione 2 — manca il ™ dopo "Tooth Talk"

Qui c'è una differenza di contenuto reale, non solo di formattazione: il
marchio è "in corso di registrazione" (lo dichiara l'Accordo stesso nel
preambolo), e nel docx firmato compare **sempre** con ™ — 16 occorrenze,
tutte marcate, non solo la prima menzione. Il codice invece non lo marca
mai: ho cercato `Tooth Talk™` in tutto `src/` e non c'è nessun risultato.
Non è un problema isolato di questo template, è sistemico su tutte le
menzioni editoriali del nome del progetto generate dal gestionale.

### Cosa fare — due commit separati, non uno solo

**Commit 1 (procedi subito, è quello già pronto):** nel template di
`generaModuloNomina()` che hai appena corretto, aggiungi il ™ nei due
punti dove compare "Tooth Talk" (riga ~1437 e riga ~1443 circa, verifica
i numeri esatti nel file corrente):

```html
&quot;Tooth Talk&quot;
```
diventa
```html
&quot;Tooth Talk™&quot;
```

Poi fai commit e deploy di questo blocco (incipit + ™): è un fix
testuale isolato, verificato con `tsc` e confronto diretto col sorgente,
nessun tocco a schema o logica — non c'è motivo di tenerlo in sospeso.

**Commit 2 (separato, stessa sessione o successiva — non mischiarlo col
primo):** sweep sistematico delle altre menzioni editoriali di "Tooth
Talk" nel codice, che ho già individuato:

- `src/lib/informativa-privacy.ts`, riga ~20 — "titolare del progetto
  editoriale "Tooth Talk"" → aggiungi ™.
- `src/app/actions-profilo.ts`, riga ~1468 — "durata della collaborazione
  con il Progetto "Tooth Talk"" → aggiungi ™.

Questi sono i 4 punti totali trovati in tutto `src/` (i 2 di
`generaModuloNomina` del commit 1, più questi 2). Prima di applicare,
cerca di nuovo tu stesso `Tooth Talk` in tutto `src/` (potresti trovarne
altri se il codice è cambiato da quando ho fatto la ricerca) e distingui:

- menzioni editoriali del progetto in testo mostrato a utenti/terzi
  (email, documenti generati, notifiche, UI) → vanno marcate con ™;
- stringhe tecniche non editoriali (nomi di variabili, tabelle, URL,
  identificatori interni, commenti nel codice) → non toccarle, il ™ lì
  non ha senso e non è quello che serve.

## Test

Dopo entrambi i commit, tutte le menzioni editoriali di "Tooth Talk"
generate dal gestionale (Modulo di Nomina, informativa privacy, email,
notifiche) devono riportare ™, coerentemente con `public/documenti/*.docx`
dove compare in ogni occorrenza, non solo alla prima menzione.
