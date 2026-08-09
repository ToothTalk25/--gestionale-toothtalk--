# Dove siamo — nota di passaggio

## Per far partire il progetto in VS Code

Nel terminale, dentro la cartella del progetto:

```bash
npm run dev
```

Poi apri http://localhost:3000

**Se la porta 3000 risulta occupata**, è un vecchio server rimasto acceso.
Chiudilo prima:

```bash
pkill -f next-server
```

Era rimasto attivo un server con Next 15 mentre il progetto è su Next 16:
mostrava una versione vecchia del codice.

## Accesso

- **enricoguarino25@gmail.com** — accesso globale (vede tutti i gruppi)
- **mario.rossi.messina@esempio.it** — account di prova, solo gruppo Messina.
  Da cancellare prima di andare online.

Le password sono quelle generate in chat. Se le hai perse, se ne imposta una
nuova dal pannello Supabase → Authentication → Users.

## Cosa funziona già

- Accesso e separazione fra gruppi: chi appartiene a Messina non vede nulla
  degli altri, nemmeno digitando l'indirizzo a mano (verificato)
- Creazione progetti, caricamento file, eliminazione libera nello spazio di
  lavoro
- Video completo: video, copertina, descrizione, script (+ liberatoria se il
  video mostra persone esterne). Sigillo → immutabile
- Invio PEC del verbale, con copia a chi ha realizzato il video
- Pagina "Video da rivedere" con richieste di modifica tracciate
- 7 gruppi: Chieti, Genova, Insubria, Messina, Milano, Palermo, UCAM

## Cosa manca

1. **Credenziali PEC** — in `.env.local` mancano `PEC_USER`, `PEC_PASSWORD`,
   `PEC_MITTENTE`, `PEC_DESTINATARI`. Senza, il pulsante di invio dà un errore
   controllato. Host e limite sono già impostati su Poste (100 MB).
2. **Account dei partecipanti** — si creano così:
   ```bash
   npm run utente -- crea nome@esempio.it "PasswordProvvisoria1!" "Nome Cognome"
   npm run utente -- assegna nome@esempio.it messina
   ```
   Gli identificativi dei gruppi: `chieti`, `genova`, `insubria`, `messina`,
   `milano`, `palermo`, `spagna`.
3. **Pubblicazione online** — oggi gira solo su questo computer. Per farlo
   usare ai gruppi serve Vercel + GitHub.

## Comandi utili

```bash
npm run dev
```

```bash
npx tsc --noEmit
```

```bash
npm run migra
```

`migra` applica le migrazioni SQL al database. Vanno eseguite in ordine; i
file che aggiungono valori di enum (`0005`, `0010`, `0012`) vanno lanciati da
soli: `npm run migra -- 0012`.

## Git

Il progetto è ora sotto controllo di versione, con un commit iniziale che
contiene tutto. Da qui in avanti conviene committare spesso:

```bash
git add -A && git commit -m "descrizione della modifica"
```

Per tornare indietro se qualcosa si rompe:

```bash
git checkout -- .
```

`.env.local` è escluso da git: le chiavi non finiranno mai in un repository.

## Il vincolo da non dimenticare

Nel README, in cima, c'è la tabella della terminologia da rispettare: niente
"titolare", "team", "collaboratore", "consegna". Vale anche per i messaggi
d'errore scritti dentro le migrazioni SQL, perché arrivano all'utente parola
per parola.
