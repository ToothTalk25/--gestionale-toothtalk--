# NOTA LEGALE — stato dei punti in sospeso (aggiornata al 22/08/2026)

Risposta al riepilogo a 4 punti di Claude Code sulle migrazioni in
attesa di valutazione legale. Questa versione sostituisce quella
precedente: nel frattempo la purga automatica alla revoca (punto 1
originario) è stata ridisegnata da zero — vedi
`PROMPT_claude_code_niente_eliminazione_automatica.md` — quindi alcune
delle domande originarie sono superate o vanno riformulate.

## 1. Purga automatica alla revoca — RIDISEGNATA, non più "in sospeso"

La domanda originaria ("includere anche immagini_montaggio nell'ambito
della purga?") presupponeva che la cancellazione restasse automatica.
Non è più così: nessuna cancellazione avviene in automatico, né per il
solo grezzo né per grezzo+pubblicato — vedi Accordo Art. 7.3, 7.4, 8.2
(già corretti) e il prompt di redesign per Claude Code. La domanda
corretta ora è: quali tipi di materiale il Coordinatore deve poter
vedere come candidati nella revisione manuale? Su questo il mio
consiglio resta lo stesso di prima: includere anche `immagini_montaggio`
tra i candidati mostrati in revisione (non solo `video_grezzo`/`audio`),
perché un fotogramma isolato può ritrarre comunque una persona
riconoscibile. Non è più un rischio di sovra-cancellazione automatica —
ora è solo materiale in più che il Coordinatore può scegliere di
eliminare o no, guardandolo.

## 2. Registro consensi `immagine_voce` — bug ancora aperto

Confermo che il fix segnalato (allargare il CHECK constraint su
`consensi.tipo`) è necessario ma incompleto. Nessun percorso di codice
inserisce oggi una riga di consenso `immagine_voce` all'approvazione
dell'accordo: `registraConsenso` accetta solo `"privacy" | "cookie"`
nella sua firma TypeScript. Allargare solo il vincolo DB non risolve il
sintomo di "0 righe aggiornate" alla revoca, perché la riga da
aggiornare non esiste mai stata creata. Serve anche inserire la riga di
concessione per `immagine_voce` nel momento dell'approvazione
dell'accordo (`approvaAccordoManualmente`), non solo permettere che
esista.

## 3a. Periodo di conservazione dei documenti di consenso firmati

Non è mai stato fissato in nessun documento — non un'omissione recente,
proprio non è mai stata presa una decisione. Consiglio un'ancora
all'art. 2946 c.c. (prescrizione ordinaria decennale) piuttosto che
all'art. 2947 (5 anni, extracontrattuale): l'accordo firmato è la prova
del consenso contrattuale, non un fatto illecito. Segnalo inoltre che
l'Informativa privacy del gestionale non dichiara ancora questo periodo
da nessuna parte — è un vuoto di trasparenza ai sensi dell'art. 13,
par. 2, lett. a) GDPR, da colmare non appena Enrico fissa il numero.

## 3b. Permessi cartella Drive "Dichiarazioni"

Non configurabile da codice: la cartella eredita i permessi della
cartella padre su Google Drive. Se Enrico vuole restringerla, deve farlo
lui stesso nelle condivisioni di Drive — nessuna azione per Claude Code
qui, solo un promemoria da girargli.

## 3c. Cancellazione pre-sigillo di un elemento del pacchetto

Compatibile con il ragionamento sullo stato probatorio del materiale
(prima del sigillo non è ancora "prova conservata", quindi rimuoverlo
non intacca la stessa garanzia legale che tutela il pacchetto sigillato).
Segnalo però che `rimuoviElementoPacchetto` non scrive oggi una riga in
`audit_log` quando l'elemento rimosso riguarda dati personali di terzi
(es. `dichiarazione_identita`) — a differenza di quasi ogni altra azione
sensibile nel gestionale, che lascia traccia. Vale la pena aggiungerla,
anche solo per coerenza con il resto del sistema.

## 3d. Visibilità del video di dichiarazione — RISOLTA

Non era una domanda legale aperta, era un disallineamento testuale:
Protocollo Art. 4.1 diceva ancora "solo Coordinatore" mentre Accordo
6.2, Protocollo 6.5 e la migrazione 0091 dicevano già uploader+admin.
Corretto oggi (Protocollo Art. 4.1, riga sulla visibilità del video di
dichiarazione) — nessuna azione ulteriore richiesta su questo punto.

## 4. Notifiche dovute Art. 8.2 (0090)

Confermo coerente con l'Accordo. Consiglio conservazione permanente
delle righe in `notifiche_dovute_art82` (anche dopo la notifica): sono
la prova che il Coordinatore ha rispettato l'obbligo di darne atto
entro 30 giorni — cancellarle vanificherebbe lo scopo stesso della
tabella in caso di contestazione futura.
