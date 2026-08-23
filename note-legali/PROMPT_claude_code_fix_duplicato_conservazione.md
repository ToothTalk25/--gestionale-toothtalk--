Contesto: ho fatto un audit completo di corrispondenza tra i 4
documenti in `public/documenti/` e il codice, dopo l'ultima modifica a
`src/lib/informativa-privacy.ts` (periodi di conservazione). Tutto
combacia — checkbox/email con menzione del Protocollo, redesign della
purga automatica (`richieste_eliminazione_grezzo`, vecchia funzione
`revoca_video_on_screen(uuid)` correttamente rimossa in 0100), pagina
`/uscita` che separa correttamente l'accesso ai documenti dalla
conferma Art. 9.4 — tranne un punto.

## Il problema

`src/lib/informativa-privacy.ts`, sezione "Conservazione", contiene ORA
due paragrafi che si sovrappongono e si contraddicono:

- Le due righe appena aggiunte (quelle con "10 (dieci) anni... dalla
  cessazione, estendibile finché il contenuto pubblicato... rimane
  online") — corrette, sono quelle richieste.
- Subito dopo il paragrafo sull'immagine/voce, ne esiste un'altra
  preesistente, mai toccata da questo task: *"I documenti di consenso
  firmati (accordo editoriale, liberatoria, video di dichiarazione di
  identità) sono conservati per un periodo di 10 (dieci) anni dalla
  cessazione della collaborazione, a tutela legale del Progetto (art.
  17, par. 3, lett. e) GDPR; prescrizione ordinaria, art. 2946 c.c.)."*

Questa seconda riga dice una cosa diversa dalla prima sullo stesso
argomento (10 anni fissi, senza l'estensione legata alla pubblicazione
del contenuto) — un lettore trova due regole di conservazione diverse
per lo stesso documento (l'accordo) nella stessa pagina. In più cita
"liberatoria" e "video di dichiarazione di identità", che non sono dati
del Collaboratore: la liberatoria dei Collaboratori è l'accordo stesso
(vedi la riga già presente più sopra: "per chi appare nei contenuti, la
cessione dei diritti di immagine e voce è già inclusa nell'accordo
stesso, non in un documento separato"), e il video di dichiarazione di
identità riguarda i terzi intervistati, non il Collaboratore che legge
questa informativa — quei dati vanno nell'informativa del Documento 2,
non qui.

## Cosa fare

Rimuovi quel paragrafo preesistente (quello con "liberatoria, video di
dichiarazione di identità"). Il suo contenuto corretto e ben scoperto
è già coperto dalle due righe nuove appena aggiunte — non serve
riscriverlo, solo toglierlo. Se in fase di rimozione trovi che serviva
a coprire qualcos'altro non ridondante, segnalalo prima di procedere
invece di cancellarlo e basta.

## Test

Dopo la modifica, la sezione "Conservazione" deve menzionare l'accordo
e la nomina una sola volta, con un solo periodo di conservazione (10
anni, estendibile finché il contenuto resta pubblicato) — non due
regole diverse per lo stesso documento.
