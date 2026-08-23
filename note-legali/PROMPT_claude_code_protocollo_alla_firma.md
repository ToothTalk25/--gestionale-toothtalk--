Contesto: l'Accordo Editoriale incorpora il Protocollo Operativo per
richiamo (Protocollo Art. 13.1: "la sottoscrizione dell'Accordo
Editoriale comporta l'accettazione integrale del presente Protocollo").
Perché quel richiamo tenga legalmente, il Collaboratore deve avere
avuto la concreta possibilità di leggere il Protocollo prima di
firmare — non basta che sia citato, va materialmente reso disponibile.
Oggi il codice non lo fa: ho cercato in tutto `src/` e il Protocollo
Operativo non viene mai allegato da nessuna parte. L'unico allegato
quando si manda l'accordo da firmare è il PDF caricato a mano in
`modello_accordo` (tabella alimentata da `CaricaModelloAccordo.tsx`) —
se oggi arriva comunque anche il Protocollo, è perché qualcuno ha
caricato lì un PDF con i due documenti uniti a mano, il che si
disallinea silenziosamente ogni volta che uno dei due testi cambia
(è già successo due volte in questa sessione con altri documenti
generati/gestiti a parte dal codice).

## Cosa fare

### 1. Allegare il Protocollo automaticamente, non a mano

Il repo ha ora anche i PDF dei 4 documenti ufficiali in
`public/documenti/` (accanto ai .docx già presenti):
`1-accordo-editoriale.pdf`, `2-informativa-liberatoria-esterni.pdf`,
`3-protocollo-operativo.pdf`, `4-modulo-nomina.pdf`. Sono la stessa
fonte che tengo aggiornata io ad ogni modifica legale.

Nel punto in cui `actions-profilo.ts` invia l'email con l'accordo da
firmare al nuovo Collaboratore (quello con `allegati: [{ filename:
nomeModello, content: bufferModello, ... }]`, intorno alla riga 1128),
aggiungi un secondo allegato leggendo `public/documenti/
3-protocollo-operativo.pdf` dal filesystem del deploy (o, se il
deploy non garantisce l'accesso a `public/` lato server, caricalo una
volta in un bucket Supabase e leggilo da lì — valuta tu qual è più
robusto in questo progetto). Così il Protocollo allegato è sempre
quello vero, non una copia incollata a mano dentro `modello_accordo`.

Di conseguenza, il PDF che carichi in `modello_accordo` d'ora in poi
dovrebbe contenere SOLO l'Accordo Editoriale, non più i due uniti —
altrimenti il Protocollo finirebbe allegato due volte. Il file
`public/documenti/1-accordo-editoriale.pdf` è già la versione corretta,
solo Accordo, aggiornata a oggi.

### 2. La dichiarazione "ho letto e compreso" deve citare anche il Protocollo

Tre punti da aggiornare, stesso significato in tutti e tre:

- `src/components/ProfiloPersonale.tsx` righe ~510-513, testo della
  checkbox: da "Ho letto e compreso tutto ciò che è scritto
  all'interno dell'accordo editoriale." a "Ho letto e compreso tutto
  ciò che è scritto all'interno dell'accordo editoriale e del
  Protocollo Operativo ad esso allegato."
- `src/app/actions-profilo.ts` riga ~782, messaggio di errore lato
  server se la spunta non arriva: "Devi confermare di aver letto e
  compreso l'accordo editoriale prima di caricarlo." → aggiungi "e il
  Protocollo Operativo".
- Stesso file, righe ~917-918 e ~933-935 (testo/HTML della PEC di
  conferma inviata al Titolare quando il Collaboratore carica
  l'accordo firmato): "di aver letto e compreso integralmente il
  contenuto dell'accordo" → "...il contenuto dell'accordo editoriale e
  del Protocollo Operativo ad esso allegato". Questo testo finisce nel
  registro con data certa via PEC: è la prova che serve in caso di
  contestazione, quindi deve essere preciso.

### 3. Il modello attivo va aggiornato comunque

A prescindere dal punto 1: il PDF attualmente attivo in
`modello_accordo` precede le modifiche di oggi (Art. 4.5-4.7, 6.2,
24→48 ore, eccetera). Se hai accesso diretto a storage/DB con service
role, puoi caricare tu stesso `public/documenti/1-accordo-editoriale.pdf`
come nuova riga in `modello_accordo` (calcolando lo SHA-256 come fa già
`caricaModelloAccordo`). Se invece l'upload richiede una sessione admin
autenticata dal browser (probabile, visto `CaricaModelloAccordo.tsx`),
dillo a Enrico: deve farlo lui dal pannello admin, un click, con il
file che gli ho già consegnato.

## Test

1. Nuova registrazione approvata → l'email al Collaboratore ha DUE
   allegati: Accordo (da `modello_accordo`, ora solo-Accordo) e
   Protocollo (da `public/documenti/3-protocollo-operativo.pdf`).
2. La checkbox e i testi delle email/PEC citano entrambi i documenti.
3. `modello_accordo` ha come riga più recente la versione di oggi
   dell'Accordo (verifica data/SHA-256).
