Contesto: l'Accordo Editoriale e il Protocollo Operativo (i file .docx in
`public/documenti/`) sono stati appena aggiornati su più punti. Il Modulo
di Nomina (Documento 4), però, non viene consegnato al Collaboratore
come file statico — `generaModuloNomina` in `src/app/actions-profilo.ts`
(righe ~1275-1372) lo genera da un template HTML incorporato nel codice,
al momento dell'approvazione dell'accordo, e lo sigilla con un hash
SHA-256. Quel template è rimasto indietro rispetto al testo attuale.

Due correzioni da fare in quel blocco HTML:

1. **Riga 1338**: "non oltre 24 ore dalla conferma di avvenuto
   caricamento" → "non oltre 48 ore dalla conferma di avvenuto
   caricamento".
2. **Riga 1347**: "comunque entro 24 ore dalla ricezione della conferma"
   → "comunque entro 48 ore dalla ricezione della conferma".
3. **Riga 1336**: "mediante dichiarazione a video in apertura di
   ripresa" descrive il vecchio modello (dichiarazione come parte
   continuativa dell'intervista). Il modello attuale (Protocollo Art.
   4.1) è un video di dichiarazione autonomo, registrato prima
   dell'intervista, caricato direttamente nella sezione "Video
   completo" del pacchetto da sigillare — non incluso nel montato,
   accesso riservato a chi lo carica e al Coordinatore. Riformula la
   riga per riflettere questo, ad esempio: "Raccolta dei recapiti
   (email o PEC) dei soggetti esterni intervistati, mediante apposito
   video di dichiarazione autonomo registrato prima di ogni intervista
   (Art. 4.1 del Protocollo Operativo);" — non è necessario il dettaglio
   completo (già nel Protocollo stesso, richiamato all'ultimo paragrafo
   del modulo), basta che non descriva più un meccanismo sbagliato.

Nessun'altra parte del codice ha bisogno di questo stesso allineamento:
ho cercato "24 ore"/"ventiquattro" e "apertura di ripresa"/"dichiarazione
a video" in tutto `src/` — l'unico punto è questo file. Accordo,
Protocollo e Documento 2 (Informativa/Liberatoria) sono file statici in
`public/documenti/`, già aggiornati, senza equivalente generato da
codice.

Non serve rigenerare i moduli già emessi in passato (sono sigillati con
hash, atti unilaterali già perfezionati) — la correzione vale solo per
le nomine generate da questo momento in poi.

Test: approva un accordo di prova, verifica che il PDF/HTML del Modulo
di Nomina generato riporti "48 ore" in entrambi i punti e la nuova
descrizione del video di dichiarazione, non quella vecchia.
