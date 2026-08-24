Contesto: da quando è stata implementata l'allegazione automatica del
Protocollo Operativo all'email di benvenuto (`actions-profilo.ts`, righe
~1156-1249), quell'email allega SEMPRE due file: `bufferModello` (letto
dalla tabella `modello_accordo`, admin-uploaded) e `protocolloPdf` (letto
sempre fresco da `public/documenti/3-protocollo-operativo.pdf`).

Il problema potenziale: se il PDF caricato in `modello_accordo` è ancora
la vecchia versione che qualcuno aveva unito manualmente (Accordo +
Protocollo incollati in un solo file, prassi precedente a questo fix),
oggi il Collaboratore riceve il Protocollo **due volte** nella stessa
PEC — una volta dentro il PDF di `modello_accordo`, una volta come
allegato separato. Non è mai stato verificato se questo sia effettivamente
il caso sui dati reali.

## Cosa verificare

1. Recupera il PDF attualmente più recente nella tabella `modello_accordo`
   (quello che `actions-profilo.ts` usa come `bufferModello` all'invio —
   guarda la query che seleziona il modello attivo, riga ~1094 o ~1123,
   per capire qual è il criterio di "più recente/attivo").
2. Controlla quante pagine ha e se contiene testo del Protocollo
   Operativo (cerca stringhe tipo "Protocollo Operativo e
   Comportamentale", "Art. 12.1", "Domande non dichiarate" — sono frasi
   che esistono solo nel Protocollo, non nell'Accordo).
3. Confronta il numero di pagine con `public/documenti/1-accordo-editoriale.pdf`
   (oggi 9 pagine) e con `public/documenti/3-protocollo-operativo.pdf`
   (oggi 5 pagine): se il modello in `modello_accordo` ha un numero di
   pagine vicino alla somma (9+5=14) o comunque contiene le stringhe del
   Protocollo, è il PDF unito vecchio — confermato il problema.

## Se confermato: come fixare

Sostituisci il contenuto in `modello_accordo` con una copia pulita di
`public/documenti/1-accordo-editoriale.pdf` (solo Accordo, nessun
Protocollo incluso), usando lo stesso meccanismo di inserimento che usa
già l'upload da pannello admin (`src/components/CaricaModelloAccordo.tsx`
+ la relativa action) — non serve reinventare il flusso, replica lo
stesso insert con il file giusto come contenuto. Mantieni la riga
precedente in tabella se il modello è storicizzato come append-only
(verifica lo schema), non sovrascriverla in place se il design esistente
non lo prevede.

Se invece la verifica al punto 2-3 esclude il problema (il modello in
`modello_accordo` è già solo Accordo), non toccare nulla: dimmi solo cosa
hai trovato, non serve nessuna azione.

## Test

Dopo l'eventuale fix, il PDF attivo in `modello_accordo` deve avere lo
stesso numero di pagine di `public/documenti/1-accordo-editoriale.pdf` e
zero occorrenze delle stringhe esclusive del Protocollo elencate sopra.
L'email di benvenuto deve continuare ad allegare entrambi i file
separatamente (questo non cambia): solo il contenuto di `modello_accordo`
deve tornare a essere Accordo-only.
