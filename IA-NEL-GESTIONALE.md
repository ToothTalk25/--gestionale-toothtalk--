# L'intelligenza artificiale nel Gestionale ToothTalk

*Quadro dei fatti, verificato nel codice il 19 settembre 2026. Non è un parere
legale: serve a mettere per iscritto che cosa fa il sistema, chi decide, e cosa
resta da sistemare.*

Perché esiste questo documento. Il regolamento europeo sull'intelligenza
artificiale (Reg. UE 2024/1689, «AI Act») chiede anche a chi **usa** un sistema
di IA — non solo a chi lo costruisce — di sapere che cosa fa, di saperlo
spiegare e di essere trasparente con le persone coinvolte. Gli obblighi
principali dell'AI Act sono in vigore dal 2 agosto 2026; la parte sulla
trasparenza (art. 50) riguarda però i sistemi che interagiscono direttamente con
le persone — al §4 si vede perché qui non scatta, e che cosa lo farebbe
scattare.

## 1. Dove l'IA è usata (due punti, entrambi in `src/lib/gemini.ts`)

| Funzione | Che cosa fa | Chi decide il risultato |
|---|---|---|
| `verificaAccordoFirmato` | Confronta l'accordo caricato dalla persona con il modello ufficiale e dice se le clausole corrispondono, se c'è una firma manoscritta, se qualcosa non torna | **Una persona** (l'accesso globale): l'esito dell'IA non sblocca né blocca niente da solo — servono l'approvazione manuale e la controfirma tracciata |
| `classificaDomandaSupporto` | Legge la domanda scritta nello spazio di supporto e la **smista**: se riguarda il funzionamento dell'app va al Collaboratore Tecnico, altrimenti al Coordinatore. **Non scrive alcun testo destinato a una persona** | **Sempre una persona**: la risposta la scrive il Collaboratore Tecnico (dalla sua pagina `/tecnico`) o il Coordinatore. L'IA decide soltanto *a chi* arrivare |

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
- **Nessun testo scritto dall'IA arriva mai a una persona.** Nella chat di
  supporto l'IA produce soltanto l'etichetta di smistamento (`categoria_ia`); la
  risposta la scrive sempre il Collaboratore Tecnico o il Coordinatore. Il widget
  non mostra nessuna bolla «IA», perché nessuna bozza viene mai salvata
  (`bozza_risposta_ia` non viene mai popolata: verificato nel punto in cui la
  funzione viene chiamata, non nel commento che la descriveva).

## 3. Dati personali che escono dal progetto

- **L'accordo firmato** (nome, indirizzo, codice fiscale, firma) viene inviato a
  Google (API Gemini) per il confronto con il modello ufficiale.
- **Il testo della domanda di supporto** viene inviato a Google per la
  classificazione.
- Entrambi sono dichiarati nell'informativa privacy («Destinatari dei dati e
  trasferimento extra-UE»), insieme al motivo di quel trattamento.

**Il punto che va chiuso per primo.** Le chiavi API gratuite di Google AI Studio
possono prevedere l'uso dei contenuti per il miglioramento dei modelli; quelle a
pagamento no. Al 19 settembre 2026 **6 accordi su 6** — caricati fra il 6 e il 18
settembre, tutti e sei passati dalla verifica IA — sono documenti con nome,
indirizzo, codice fiscale e firma. L'informativa dichiara quell'invio a Google
**dal 21 agosto 2026**, quindi nessun accordo è passato in silenzio; ma il
livello della chiave va verificato sull'account Google: se è gratuito, va portato
al livello a pagamento (o a Vertex AI) e la chiave va ristretta a una sola API.

## 4. Perché non è un sistema «ad alto rischio» (e quando lo diventerebbe)

- **Pratiche vietate** (art. 5): non riguardano questo uso.
- **Sistemi ad alto rischio** (Allegato III): no. Il sistema non incide su
  lavoro, istruzione, servizi essenziali; non usa dati biometrici; non valuta
  persone per ammetterle, escluderle o graduarle.
- **Obblighi di trasparenza** (art. 50): non scattano. L'articolo riguarda i
  sistemi che **interagiscono direttamente** con le persone: qui nessuno parla
  con l'IA e nessun testo prodotto dall'IA arriva a qualcuno — l'IA legge e
  smista, la risposta la scrive una persona. La trasparenza che serve è di altra
  natura e c'è: l'informativa dichiara il trattamento via IA e il fornitore
  (Google), e il widget lo ripete dove la persona scrive («La tua domanda viene
  ordinata da un sistema automatico; a risponderti è sempre una persona»).

**Il confine da non superare.** Se un domani l'IA servisse a *valutare una
persona* — ammetterla o escluderla dal progetto, giudicare il suo lavoro,
decidere su di lei — il sistema diventerebbe probabilmente ad alto rischio, con
obblighi molto più pesanti (documentazione tecnica, sorveglianza umana
strutturata, valutazione d'impatto). Oggi non è così, e non deve diventarlo per
distrazione: l'IA legge documenti, non giudica persone.

## 5. Dati personali e dati delicati: i due confini

**Quello che contiene l'accordo.** Nome, indirizzo, codice fiscale e firma sono
**dati personali comuni**, non «categorie particolari» dell'art. 9 GDPR (salute,
genetica, biometria usata per identificare, convinzioni religiose o politiche,
origine, vita sessuale). Negli accordi non c'è nessuna categoria particolare:
l'AI Act non vieta di inviarli a un modello, e il GDPR li governa con gli
obblighi del §3 (base giuridica, trasparenza, fornitore, trasferimento).

**Primo confine — la firma.** Chiedere al modello «c'è una firma manoscritta?»
resta un controllo sul *documento*, e non trasforma la firma in un dato
biometrico. Diventerebbe **identificazione biometrica** — art. 9 GDPR e materia
biometrica dell'AI Act — il momento in cui un sistema automatico venisse usato
per **identificare o verificare la persona** attraverso la firma (o il volto, o
la voce): «è davvero la firma di Mario Rossi?» non è una domanda da fare a un
modello, mai.

**Secondo confine — la chiave.** Il rischio vero oggi non è l'AI Act, è il
livello della chiave Google (§3): un servizio che può usare i contenuti per
addestrarsi, applicato a documenti con codice fiscale e firma.

**Dove possono comparire dati delicati.** Nell'accordo no; possono comparire, se
chi scrive li mette, nello spazio delle domande di supporto — testo libero fino a
4000 caratteri, dove può finire un «ho l'influenza, posso spostare il turno?».
Per questo l'informativa invita a non scriverli e il widget lo ripete proprio
dove si scrive.

## 6. Che cosa lasciamo scritto, per poterlo dimostrare

- l'esito dell'IA su ogni accordo, con la sua nota, nel profilo della persona e
  nel registro append-only;
- chi ha approvato a mano e quando;
- quando l'IA ha classificato ogni domanda di supporto (`bozza_generata_at`) e in
  quale categoria l'ha messa: la traccia dello smistamento, senza nessun testo
  scritto dall'IA;
- la storia delle modifiche del *prompt* (il comportamento del sistema è il
  prompt): si annota nel diario del progetto quando cambia.

## 7. Quello che resta da fare

1. **Verificare il livello della chiave Google** (§3) e, se gratuito, passare al
   livello a pagamento o a Vertex AI. È il punto da chiudere per primo: 6 accordi
   sono già passati di lì.
2. **Valutazione d'impatto (DPIA)**: da valutare **con il legale**. Gli elementi
   per dire che non è obbligatoria ci sono (nessun monitoraggio sistematico su
   larga scala, nessuna categoria particolare, nessuna decisione automatizzata),
   ma è un giudizio, non una certezza — e va rifatta se comparisse un uso che
   tocca le persone (vedi il confine del §4).
3. **Alfabetizzazione sull'IA (art. 4)**: chi adopera il gestionale deve sapere
   che l'esito dell'IA è un suggerimento da leggere con giudizio. Basta leggere
   il §2 di questo documento: è breve di proposito.
4. **Rileggere l'informativa** quando cambia qualcosa qui dentro. L'informativa
   del gestionale è allineata a oggi (dichiara il trattamento via IA, il fornitore
   e la decisione umana) e **non è il Documento 2 dentro l'accordo**: si aggiorna
   senza toccare nulla di ciò che è già stato firmato.
