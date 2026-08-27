# Prompt per Claude Code — aggiungere il secondo fondamento giuridico (interesse legittimo) in `informativa-privacy.ts`

## Contesto

Accordo Editoriale (Art. 8.3) e Documento 2 (liberatoria terzi) sono già stati aggiornati:
oltre al consenso per l'atto di pubblicazione, ora dichiarano un secondo fondamento
giuridico — il legittimo interesse del Progetto (art. 6.1.f GDPR) a mantenere accessibile
un contenuto già pubblicato che continua ad avere valore informativo/educativo — con
diritto di opposizione (art. 21 GDPR) sempre garantito. `informativa-privacy.ts` deve
riflettere lo stesso doppio fondamento, altrimenti i tre documenti non sono più coerenti.

Non toccare nessuna logica applicativa: ho già verificato che nessun codice ramifica su
quale base giuridica si applica (è tutto testo statico). Sono due modifiche di sola
stringa, entrambe in `src/lib/informativa-privacy.ts`.

## Modifica 1 — riga ~40-46, lista "Finalità e base giuridica"

C'è già una voce "Interesse legittimo (art. 6.1.f GDPR)" per la tutela legale via
PEC/registro append-only (riga 45) — è un interesse legittimo DIVERSO, non toccarlo.
Aggiungere una nuova voce distinta subito dopo, per il mantenimento online dei contenuti
già pubblicati:

```
"Interesse legittimo (art. 6.1.f GDPR): mantenere accessibile, dopo la prima pubblicazione, un contenuto che continua a svolgere una funzione informativa ed educativa in ambito di prevenzione odontoiatrica — fermo restando il diritto di opposizione (art. 21 GDPR);",
```

## Modifica 2 — riga ~86, paragrafo "Revoca del consenso" in "Consenso per chi appare nei contenuti"

Testo attuale (frase finale, da individuare per match esatto):

```
"...non comporta invece, di per sé, la rimozione dei contenuti già pubblicati, salvo richiesta esplicita in tal senso. Richieste di rimozione di un contenuto già pubblicato sono valutate caso per caso, alla luce delle finalità editoriali del Progetto e delle eccezioni di cui all'art. 17, par. 3, GDPR (libertà di espressione e informazione), con risposta entro 30 (trenta) giorni, prorogabile a 90 (novanta) giorni con motivazione scritta."
```

Sostituire con:

```
"...non comporta invece, di per sé, la rimozione dei contenuti già pubblicati: questi restano online anche sulla base del legittimo interesse del Progetto a mantenerli accessibili (vedi sopra), fermo restando il diritto di opporsi in qualsiasi momento ai sensi dell'art. 21 GDPR. Richieste di rimozione o opposizione relative a un contenuto già pubblicato sono valutate caso per caso, bilanciando il legittimo interesse del Progetto con quello dell'interessato e le eccezioni di cui all'art. 17, par. 3, GDPR (libertà di espressione e informazione), con risposta entro 30 (trenta) giorni, prorogabile a 90 (novanta) giorni con motivazione scritta."
```

Il resto del paragrafo (revoca, individuazione/cancellazione materiale grezzo non
pubblicato, termine 30gg) resta identico — sostituisci solo dalla frase "non comporta
invece" in poi.

## Modifica facoltativa 3 — `src/components/RichiesteRimozionePubblicato.tsx`

È testo cosmetico del pannello admin, non blocca nulla se salti questa parte. Se la fai:
il bottone/label che oggi dice `"Rifiutato (eccezione art. 17.3.a)"` (riga ~113) andrebbe
in qualcosa come `"Rifiutato (prevale l'interesse del Progetto)"`, e il testo esplicativo
alle righe 14-18/60-61 andrebbe allineato alla stessa logica di bilanciamento invece della
sola eccezione. Nessuna modifica di logica, solo copy.

## Verifica prima di commit/deploy

- Confermare che la nuova voce "Interesse legittimo" nella lista non sostituisca quella
  già esistente sul PEC/append-only — devono coesistere come due voci separate, ognuna
  con il proprio scopo specifico (un principio di interesse legittimo generico o
  cumulativo non regge davanti al Garante).
- Render della pagina `/privacy` e controllo visivo che il testo sia leggibile e coerente.

Le modifiche non sono committate: fammi sapere l'esito prima di committare e fare il deploy.
