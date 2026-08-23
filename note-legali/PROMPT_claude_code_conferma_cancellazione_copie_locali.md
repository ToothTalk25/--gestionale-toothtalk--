Contesto: oggi sono stati aggiornati Accordo Editoriale, Protocollo
Operativo e Documento 2 (Informativa/Liberatoria terzi) su più punti
testuali (Art. 12.1 del Protocollo — meccanismo di aggiornamento;
Art. 4.1 — nota di buona pratica sul video di integrazione; Art. 4.7
dell'Accordo — criterio di confusione sul riuso dei contenuti; rimossi
università/matricola dall'intestazione dell'Accordo e aggiunto un
Art. 2.4 sul fatto che la collaborazione non dà CFU/ECTS; corretto il
blocco firma finale del Documento 2, che descriveva campi da compilare
a mano — nome, data, firma — quando in realtà la conferma avviene solo
con il codice OTP). Ho verificato tutto il codice sorgente: nessuno di
questi punti ha una controparte incorporata nel codice (a differenza di
quanto successo altre volte in questa sessione con `generaModuloNomina`
e il template dell'email di invio accordo) — sono modifiche
esclusivamente ai file in `public/documenti/`, già aggiornati, nessuna
azione di sincronizzazione richiesta su questi punti.

C'è però un punto sostanziale, distinto dai testi di oggi, che richiede
una vera funzionalità nuova.

## Conferma di cancellazione delle copie locali alla cessazione

L'Art. 9.4 dell'Accordo dice: "il Collaboratore procede alla
cancellazione definitiva di qualsiasi copia locale dei materiali
grezzi, dei recapiti e degli altri dati personali di terzi ancora in
suo possesso, entro 48 (quarantotto) ore dalla data di cessazione,
dandone comunicazione al Coordinatore." Oggi, per quanto ho trovato,
questa "comunicazione" non ha alcun meccanismo nel gestionale — non è
un problema nuovo, semplicemente non è mai stato costruito.

Non va risolto con un modulo separato da firmare (scartato
esplicitamente: il Titolare vuole tutto tramite gestionale/comunicazione
digitale, niente di cartaceo o stile-modulo-con-firma). Il modo coerente
con il resto del sistema è una conferma digitale, stesso pattern già
usato per "ho letto e compreso" l'accordo e per l'OTP della liberatoria:

- Quando una collaborazione viene terminata (sia dal Coordinatore — vedi
  la funzione che gestisce "Termina Collaborazione" in
  `actions-profilo.ts`, intorno alla riga 191 — sia per recesso del
  Collaboratore), presenta al Collaboratore uscente una richiesta di
  conferma: checkbox o bottone con testo tipo "Confermo di aver
  cancellato tutte le copie locali dei materiali grezzi, dei recapiti e
  degli altri dati personali di terzi ancora in mio possesso, ai sensi
  dell'Art. 9.4 dell'Accordo Editoriale."
- Registra la conferma con timestamp in `audit_log` (stesso meccanismo
  già usato altrove in questo progetto per tracciare azioni sensibili),
  collegata all'utente e alla data di cessazione.
- Se il Collaboratore non conferma entro le 48 ore previste dall'Art.
  9.4, non c'è bisogno di un blocco tecnico (il Coordinatore non ha
  comunque modo di verificarlo fisicamente) — basta che resti visibile
  nel pannello admin come "conferma non ancora ricevuta", sullo stesso
  modello già usato per `notifiche_dovute_art82`.

Valuta tu se serve una nuova tabella dedicata o se basta un campo su
`profiles` (es. `cancellazione_copie_confermata_at`) — la seconda è più
semplice e probabilmente sufficiente, visto che è un'unica conferma
puntuale per persona, non una coda di richieste da gestire come
`notifiche_dovute_art82`.

## Test

1. Termina una collaborazione di prova (o simula un recesso): al
   Collaboratore appare la richiesta di conferma.
2. Conferma: viene registrata con timestamp, visibile all'admin.
3. Se non confermata entro 48 ore, l'admin la vede segnalata come
   pendente da qualche parte visibile (pannello admin), senza che
   questo blocchi nient'altro nel gestionale.
