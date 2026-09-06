# Prompt per Claude Code — minimizzazione dati personali del Titolare

## Contesto

Nei documenti legali (già corretti a parte, in .docx/.pdf, non serve toccarli) e nel
codice del gestionale compare in più punti l'indirizzo di residenza privata di Enrico
("Via Bozzano n.11 16143 Genova") e la sua Gmail personale
(`enricoguarino25@gmail.com`) come recapito pubblico per l'esercizio dei diritti GDPR.

Decisioni già prese da Enrico:
- L'indirizzo postale va **rimosso del tutto** dai testi pubblici, non sostituito con
  un altro. Il GDPR (art. 13-14) richiede identità e dati di contatto del Titolare, non
  necessariamente un indirizzo fisico: email e PEC bastano come "dati di contatto."
  L'indirizzo era la sua residenza privata.
- L'email pubblica va sostituita ovunque con `tooth.talk25@gmail.com` (è già
  l'indirizzo da cui parte la posta automatica del gestionale, quindi nessuna nuova
  casella da creare o monitorare).
- La PEC (`enricomariaguarino@postecertifica.it`) e il nome/C.F. di Enrico Maria
  Guarino **restano invariati**: sono l'identificazione legale del Titolare del
  trattamento (persona fisica, non società) richiesta dal GDPR — non sono dati da
  minimizzare, sono l'informazione che la legge impone di mostrare. Non toccarli.

## Modifiche richieste

### 1. `src/lib/informativa-privacy.ts`
- Riga 20 (blocco Titolare): rimuovi `, con sede in Via Bozzano n.11 16143 Genova`
  dalla frase; sostituisci `enricoguarino25@gmail.com` con `tooth.talk25@gmail.com`.
- Riga 77 ("Per esercitarli, scrivi a..."): sostituisci l'email.
- Riga 87 (paragrafo "Revoca del consenso..."): sostituisci l'email
  (`oppure scrivendo a enricoguarino25@gmail.com`).

### 2. `src/lib/liberatoria-documento2.ts`
- Riga 13 (Sezione 1, punto 1 "Titolare del trattamento"): rimuovi la clausola
  dell'indirizzo (`con sede in Via Bozzano n.11 16143 Genova`); sostituisci l'email.
- Riga 22 (Sezione 1, punto 10 "Esercizio dei diritti"): sostituisci l'email; **rimuovi
  del tutto** la frase `, indirizzo postale Via Bozzano n.11 16143 Genova` (non
  sostituirla con altro indirizzo, va tolta e basta, mantenendo solo email e PEC).
- Riga 34 (Sezione 2, "REVOCA DEL CONSENSO..."): sostituisci
  `(enricoguarino25@gmail.com)` con `(tooth.talk25@gmail.com)`.

### 3. `src/app/carica-liberatoria/page.tsx`
- Righe 216-217 (link `mailto:` nella nota per i minorenni): sostituisci l'indirizzo
  con `tooth.talk25@gmail.com`, sia nell'`href` che nel testo visibile.

### 4. `src/app/termini/page.tsx`
- Riga 108 ("Contatto: enricoguarino25@gmail.com..."): sostituisci l'email, lascia
  invariata la PEC.

## Verifica richiesta

1. `grep -rn "enricoguarino25@gmail.com\|Via Bozzano" src/` deve restituire zero
   risultati in tutto `src/`.
2. `npx tsc --noEmit` e `npm run build` puliti.
3. Rendering di `/privacy`, `/carica-liberatoria` e `/termini`: conferma visiva che
   mostrino `tooth.talk25@gmail.com` e nessun indirizzo postale residuo.
4. Non toccare nome, C.F. o PEC in nessuno dei file — solo email e indirizzo.

Non committare né pushare senza il mio ok esplicito.

## Nota permanente, non un'azione da fare ora

Le copie dell'Accordo Editoriale già firmate da collaboratori reali prima di questa
modifica contengono ancora l'indirizzo di residenza privata: questo fix ferma
l'esposizione futura, non è retroattivo sulle copie già distribuite/archiviate. Se in
futuro serve un intervento anche su quelle, è una decisione separata da prendere a
parte.
