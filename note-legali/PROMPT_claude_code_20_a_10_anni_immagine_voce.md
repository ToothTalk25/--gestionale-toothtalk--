Contesto: allineamento del periodo di conservazione per immagine/voce di
chi appare nei contenuti pubblicati. Deciso con Enrico: portare il tetto
da 20 a 10 anni, stessa struttura (revisione ogni 5 anni, cancellazione
di default in assenza di motivazione scritta). Motivo: il vero
meccanismo di protezione è la revisione quinquennale, non il tetto
massimo — abbassarlo non indebolisce la tutela, e allinea questa voce
alle altre due (accordo/nomina e materiali certificati/PEC, già a 10
anni), invece di avere un numero isolato più alto.

Ho già aggiornato Documento 2 (`public/documenti/2-informativa-liberatoria-esterni.docx/pdf`),
già in libreria. Manca solo `informativa-privacy.ts`.

## Cosa modificare

`src/lib/informativa-privacy.ts`, riga 59:

```
"Per l'immagine e la voce di chi appare nei contenuti pubblicati: conservazione per un periodo massimo di 20 (venti) anni dalla data di pubblicazione, con revisione almeno ogni 5 (cinque) anni per valutare se il contenuto mantenga un interesse editoriale/documentale. In assenza di una motivazione scritta di rilevanza storica, culturale o scientifica, i dati vengono cancellati allo scadere del quinto anno."
```

Sostituisci "20 (venti)" con "10 (dieci)". Resto della frase invariato.

## Test

Cerca "20 (venti)" in tutto `src/lib/informativa-privacy.ts`: non deve
comparire più. La frase deve dire "10 (dieci) anni", identica a
`public/documenti/2-informativa-liberatoria-esterni.docx`.
