Contesto: lavorazione in corso sul Piano Editoriale, sul Calendario
Editoriale e sulle guide facoltative per format (i documenti che la
pagina `/risorse` oggi mostra come "Contenuto in arrivo"). Durante la
lettura del codice è emerso un punto di incoerenza fra l'interfaccia e
l'architettura giuridica del Progetto, che va chiuso subito e da solo.

Questo prompt contiene **un solo commit pronto**. Il resto della
lavorazione su `/risorse` arriverà dopo, quando i documenti esistono:
vedi "Cosa NON fare adesso" in fondo — non anticiparlo.

## Commit 1 — `/risorse`: il calendario non ha "scadenze"

`src/app/(app)/risorse/page.tsx`, riga 24, descrive il Calendario
Editoriale così:

```
descrizione: "Le uscite programmate e le scadenze del canale.",
```

La parola "scadenze" contraddice due fonti vincolanti del Progetto:

- **Accordo Editoriale, Art. 1.1**: «Il Piano Editoriale e il Calendario
  Editoriale sono strumenti informativi messi a disposizione dal
  Coordinatore; la partecipazione a specifiche proposte resta libera.»
- **Protocollo Operativo, Art. 3.1**: Piano e Calendario «hanno natura
  informativa e organizzativa: indicano le proposte di contenuto
  disponibili, senza costituire obbligo di rispetto per il Collaboratore».

L'intera architettura del Progetto è costruita per escludere la
qualificazione di lavoro subordinato (Accordo Art. 2.3), e "scadenza" è
lessico di obbligazione. Un'interfaccia che promette scadenze mentre i
documenti firmati le escludono è il tipo di incoerenza che, in una
verifica, pesa più di un articolo scritto bene.

Sostituisci con una formulazione che descriva il calendario come
proposta e non come termine. Ad esempio:

```
descrizione: "I periodi tematici e le proposte di uscita del canale.",
```

La formulazione esatta è a tua scelta, purché: (a) non contenga
"scadenza", "termine", "entro", "obbligo" o sinonimi; (b) resti coerente
con il registro delle altre due card della stessa pagina.

**Non toccare** la descrizione del Piano Editoriale (riga 20) né quella
della Guida facoltativa (riga 27): sono già corrette. Non toccare il
badge "Facoltativo" né il componente `ContenutoRisorsa`.

## Nota su un falso allarme, così non ci torni sopra

Ho verificato se il lessico "task" (route `/task/[taskId]`, tabella
`tasks`, `NewTaskForm`) ponesse lo stesso problema del punto sopra.
**Non lo pone, e non va cambiato.** Le stringhe mostrate all'utente sono
già neutre ("Titolo del video", "Formato del contenuto", "Script
(bozza)"); "task" resta confinato a nome di tabella, colonne, variabili
e route — cioè codice tecnico non esposto come copy, che per la regola
già stabilita nel prompt sulla terminologia non si tocca. Rinominare la
route avrebbe un costo (link, redirect, riferimenti) sproporzionato al
beneficio.

## Cosa NON fare adesso

Due interventi su `/risorse` sono già previsti ma **non sono ancora
decisi e non vanno anticipati**:

1. **La card "Guida facoltativa alla realizzazione di un format" è una
   sola e generica.** Diventerà una guida per ciascun format attivo. La
   ristrutturazione della pagina (e la forma dei dati che la alimenta) va
   fatta quando le guide esistono e se ne conosce il numero definitivo,
   non prima: rifarla due volte è lavoro sprecato.

2. **I contenuti di Piano e Calendario Editoriale** sono in stesura. Le
   card restano "Contenuto in arrivo" finché non arrivano i documenti.

## Domanda aperta al Coordinatore (non è codice, non agire)

In `supabase/migrations/0011_formati.sql` il seed della tabella
`formati` imposta `richiede_liberatoria = true` per `orientamento` ed
`eventi`, con un commento che dichiara la classificazione «DA
CONFERMARE: solo "Parola al Professionista" è certo».

Il punto merita una verifica del Coordinatore, non una modifica
autonoma: quando un contenuto di Orientamento è l'auto-narrazione di un
Collaboratore che ha già sottoscritto l'Accordo, il consenso all'uso di
immagine e voce è già coperto dall'Art. 7.1 dell'Accordo stesso, e la
liberatoria di terzi (Documento 2) non serve. Se la maggior parte dei
contenuti Orientamento è di questo tipo, il flag `true` genera un
adempimento che non ha destinatario. Resta invece corretto quando nel
contenuto compare una persona esterna.

Non modificare il seed. Segnala e attendi.

## Test

Dopo il commit: nessuna occorrenza di "scadenze" (né sinonimi di
obbligazione) nelle descrizioni di `/risorse`; le altre due card
invariate; badge "Facoltativo" invariato; la pagina continua a
richiedere la sessione (`requireSession`) e a mostrare "Contenuto in
arrivo" su tutte e tre le card.
