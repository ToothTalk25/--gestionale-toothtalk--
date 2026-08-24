Contesto: ho verificato tutti i commit degli ultimi due prompt (TM, e
cleanup terminologia/università) direttamente sul codice — sono stati
applicati bene: nessun "referente" residuo, "contratto"→"accordo" fatto,
"append-only" spiegato, ™ aggiunto ovunque, nessuna "Gruppo
universitario" residua, il campo Università è sparito dal form profilo,
il messaggio d'errore della PEC non parla più di ateneo, il link della
pagina privacy torna al gestionale se aperta da lì. Resta un solo punto
non coperto.

## Il residuo

In `src/app/actions-profilo.ts`, righe 1020 e 1037 (email/PEC inviata
quando un Collaboratore carica l'accordo editoriale firmato), c'è ancora:

```
`del registro dei partecipanti. Università: ${profile.universita ?? "non indicata"}.`
```

(versione testo, riga 1020) e la stessa frase in HTML alla riga 1037.
Non era tra i file che ti avevo elencato esplicitamente la volta scorsa,
ma rientra nello stesso criterio: è un riferimento all'università che
finisce in una comunicazione ufficiale (email + registrazione PEC),
quindi va tolto per coerenza con tutto il resto già fatto.

## Cosa fare

Togli la frase `Università: ${profile.universita ?? "non indicata"}.` da
entrambe le versioni (testo e HTML) dell'email. Non serve sostituirla con
altro — le due frasi restano comunque complete e sensate senza quella
informazione (il "registro dei partecipanti" non ha bisogno di
specificare l'università per essere un riferimento valido).

## Test

Cerca "università" (case-insensitive) in tutto `src/`: non deve
comparire più da nessuna parte, salvo eventualmente nel commento interno
di `ProfiloPersonale.tsx` se esiste ancora (verifica) — se c'è, toglilo
pure, è residuo anche quello.
