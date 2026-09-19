# L'intelligenza artificiale nel Gestionale ToothTalk

*Quadro dei fatti, verificato nel codice il 19 settembre 2026. Non è un parere
legale: serve a mettere per iscritto che cosa fa il sistema, chi decide, e cosa
resta da sistemare.*

Perché esiste questo documento. Il regolamento europeo sull'intelligenza
artificiale (Reg. UE 2024/1689, «AI Act») chiede anche a chi **usa** un sistema
di IA — non solo a chi lo costruisce — di sapere che cosa fa, di saperlo
spiegare e di essere trasparente con le persone coinvolte. Gli obblighi di
trasparenza dell'articolo 50 si applicano dal 2 agosto 2026: sono già in vigore.

## 1. Dove l'IA è usata (due punti, entrambi in `src/lib/gemini.ts`)

| Funzione | Che cosa fa | Chi decide il risultato |
|---|---|---|
| `verificaAccordoFirmato` | Confronta l'accordo caricato dalla persona con il modello ufficiale e dice se le clausole corrispondono, se c'è una firma manoscritta, se qualcosa non torna | **Una persona** (l'accesso globale): l'esito dell'IA non sblocca né blocca niente da solo — servono l'approvazione manuale e la controfirma tracciata |
| `classificaDomandaSupporto` | Classifica una domanda di supporto e, se è una domanda tecnica generica, **scrive la bozza di risposta** che viene inviata subito | **Nessuno, per le domande tecniche**: la bozza parte automaticamente. Tutte le altre domande vanno al Coordinatore, e la risposta la scrive una persona |

Modello: Google **Gemini** (`gemini-3.5-flash`, con ripiego su
`gemini-3.6-flash`) via API `generativelanguage.googleapis.com`. Google è il
fornitore del modello di IA per finalità generali; il progetto ne è
**utilizzatore** (in gergo: *deployer*), non fornitore.

## 2. Che cosa l'IA non fa (verificato, non promesso)

- **Nessun riconoscimento facciale né confronto di volti.** La funzione che
  esisteva (confronto fra volti nei video e foto profilo) è stata **rimossa dal
  codice**, non solo disattivata, dopo un audit GDPR: l'informativa dichiarava
  assente ogni trattamento di riconoscimento facciale e la funzione invece lo
  effettuava. La tabella `verifiche_riconoscimento` è rimasta vuota (0 righe).
- Nessuna categorizzazione biometrica, nessun riconoscimento delle emozioni.
- Nessuna profilazione e nessuna decisione interamente automatizzata su una
  persona (art. 22 GDPR): l'accesso ai progetti si apre con l'approvazione
  manuale e la controfirma.
- Nessun contenuto pubblicato è generato dall'IA.

## 3. Dati personali che escono dal progetto

- **L'accordo firmato** (nome, indirizzo, codice fiscale, firma) viene inviato a
  Google (API Gemini) per il confronto con il modello ufficiale.
- **Il testo della domanda di supporto** viene inviato a Google per la
  classificazione.
- Entrambi sono dichiarati nell'informativa privacy («Destinatari dei dati e
  trasferimento extra-UE»), insieme al motivo di quel trattamento.

**Punto aperto da verificare.** Le chiavi API gratuite di Google AI Studio
possono prevedere l'uso dei contenuti per il miglioramento dei modelli; quelle a
pagamento no. Prima di considerare chiuso il trattamento di un documento che
contiene codice fiscale e firma, va verificato a quale delle due appartiene la
chiave in uso; se è gratuita, va passata al livello a pagamento (o a Vertex AI).

## 4. Perché non è un sistema «ad alto rischio» (e quando lo diventerebbe)

- **Pratiche vietate** (art. 5): non riguardano questo uso.
- **Sistemi ad alto rischio** (Allegato III): no. Il sistema non incide su
  lavoro, istruzione, servizi essenziali; non usa dati biometrici; non valuta
  persone per ammetterle, escluderle o graduarle.
- **Obblighi di trasparenza** (art. 50): sì, uno — il testo scritto dall'IA
  inviato a una persona deve essere riconoscibile come scritto da un sistema
  automatico. L'etichetta nella chat diceva solo «Assistente», che si legge come
  una persona: **corretta** in «Assistente automatico (IA)», con una riga che
  spiega che nessuno l'ha controllata prima.

**Il confine da non superare.** Se un domani l'IA servisse a *valutare una
persona* — ammetterla o escluderla dal progetto, giudicare il suo lavoro,
decidere su di lei — il sistema diventerebbe probabilmente ad alto rischio, con
obblighi molto più pesanti (documentazione tecnica, sorveglianza umana
strutturata, valutazione d'impatto). Oggi non è così, e non deve diventarlo per
distrazione: l'IA legge documenti, non giudica persone.

## 5. Che cosa lasciamo scritto, per poterlo dimostrare

- l'esito dell'IA su ogni accordo, con la sua nota, nel profilo della persona e
  nel registro append-only;
- chi ha approvato a mano e quando;
- la storia delle modifiche del *prompt* (il comportamento del sistema è il
  prompt): si annota nel diario del progetto quando cambia.

## 6. Quello che resta da fare

1. **Verificare il livello della chiave Google** (§3) e, se gratuito, passare al
   livello a pagamento.
2. **Alfabetizzazione sull'IA (art. 4)**: chi usa il gestionale deve sapere che
   l'esito dell'IA è un suggerimento da leggere con giudizio. Basta leggere il §2
   di questo documento: è breve di proposito.
3. **Valutazione d'impatto (DPIA)**: non è richiesta da questo uso, ma va
   rifatta se comparisse un uso che tocca persone (vedi il confine del §4).
4. **Rileggere l'informativa** quando cambia qualcosa qui dentro: l'informativa è
   già allineata a oggi (dichiara il trattamento via IA, il fornitore e la
   decisione umana).
