Contesto: ho ricevuto un tuo report di audit sui 4 documenti legali che
cita, al punto 4, questo testo per l'Art. 2.4 dell'Accordo:

> "2.4. Il Collaboratore dichiara di essere studente/ssa universitario/a
> e di partecipare al Progetto in tale veste..."

Questo testo NON esiste più in `public/documenti/1-accordo-editoriale.docx`.
È stato riscritto in forma condizionale ("Qualora il Collaboratore sia...
studente universitario/a...") perché al Progetto partecipano anche
Collaboratori che non sono studenti, e la vecchia formulazione dichiarava
quella qualità per chiunque firmasse. Ho tolto la stessa assunzione anche
dal preambolo dell'Accordo (dove si identifica "il Collaboratore"). Se
generi ancora un report con quel testo, stai leggendo una copia
non aggiornata — verifica sempre `public/documenti/*.docx` nel repo
corrente, non una cache locale, prima di fare un audit.

Gli altri due punti del tuo report li ho già verificati direttamente sul
sorgente e chiusi:
- l'email nella sezione 10 dell'Informativa (Documento 2) è corretta
  (`enricoguarino25@gmail.com`) in entrambi i punti del documento — nessun
  refuso, falso allarme;
- l'incipit del Modulo di Nomina (Documento 4) è già stato riscritto:
  "il/la Collaboratore/trice ________, nato/a a..., quale persona
  autorizzata al trattamento..." al posto della vecchia forma ambigua
  "che ________... è nominato/a persona autorizzata...".

## Il problema reale che ho trovato controllando il codice

Proprio quell'ultimo fix (l'incipit del Modulo di Nomina) non è stato
propagato al codice. `generaModuloNomina()` in `src/app/actions-profilo.ts`
(circa righe 1428-1438) genera ancora l'HTML con la vecchia formulazione:

```html
<p>che <strong>${esc(nome)}</strong>, nato/a a ${esc(c.luogo_nascita)} il ${dataNascitaIt},
C.F. ${esc(c.codice_fiscale)}, avendo sottoscritto in data ${dataSottoscrizioneIt} l'Accordo
Editoriale per la collaborazione volontaria al Progetto &quot;Tooth Talk&quot;, è nominato/a persona
autorizzata al trattamento dei dati personali ai sensi dell'art. 29 del Regolamento (UE) 2016/679
(GDPR) e dell'art. 2-quaterdecies del D.Lgs. 196/2003 e s.m.i. (Codice Privacy), sotto l'autorità
e le istruzioni documentate del Titolare del trattamento.</p>
```

Il Modulo di Nomina generato dal gestionale per ogni Collaboratore, quindi,
ha ancora l'incipit ambiguo che il template docx in libreria non ha più —
è di nuovo il solito problema delle copie indipendenti dello stesso testo
legale.

## Cosa fare

Sostituisci quel paragrafo con:

```html
<p>Il/la Collaboratore/trice <strong>${esc(nome)}</strong>, nato/a a ${esc(c.luogo_nascita)} il ${dataNascitaIt},
C.F. ${esc(c.codice_fiscale)}, avendo sottoscritto in data ${dataSottoscrizioneIt} l'Accordo
Editoriale per la collaborazione volontaria al Progetto &quot;Tooth Talk&quot;, quale persona
autorizzata al trattamento dei dati personali ai sensi dell'art. 29 del Regolamento (UE) 2016/679
(GDPR) e dell'art. 2-quaterdecies del D.Lgs. 196/2003 e s.m.i. (Codice Privacy), sotto l'autorità
e le istruzioni documentate del Titolare del trattamento.</p>
```

Non toccare il paragrafo precedente ("Il sottoscritto Enrico Maria
Guarino... DICHIARA E NOMINA") né il resto del documento (Ambito
dell'autorizzazione, obblighi, ecc.): non contengono la stessa costruzione
e non serve intervenire lì.

## Test

Genera un Modulo di Nomina per un profilo di prova e confronta il testo
dell'incipit con `public/documenti/4-modulo-nomina.docx` (o il PDF
gemello): devono coincidere parola per parola, a parte l'ovvia
sostituzione dei placeholder con i dati reali del Collaboratore.
