Contesto: il Titolare ha deciso oggi i periodi di conservazione per due
categorie di dati che restano dopo l'anonimizzazione del profilo
(`eliminaAccount`, funzionalità preesistente — anonimizza email, nome,
PEC, università, foto; conserva accordo firmato, nomina, materiali
certificati, archivio PEC). Non erano mai stati fissati prima.

Base giuridica — **il Titolare vuole i riferimenti normativi scritti
per esteso nel testo dell'informativa, non solo come motivazione
interna**: art. 5, par. 1, lett. e), GDPR (limitazione della
conservazione, con revisione periodica invece di un termine fisso —
Considerando 39); per l'accordo/nomina, l'onere della prova del
consenso resta in capo al Titolare finché il contenuto che autorizzano
resta pubblicato (artt. 5, par. 2, e 7, par. 1, GDPR) — quindi la
conservazione non può avere un tetto rigido più corto della
conservazione dell'immagine/voce già fissata altrove nella stessa
informativa (20 anni, revisione ogni 5); per i materiali
certificati/PEC, art. 17, par. 3, lett. e), GDPR e artt. 2946 e 2947
c.c. (prescrizione civile) per la difesa legale. Ho già scritto questo
stesso set di citazioni nel Documento 2 (vedi Nota in fondo) — usa la
stessa formulazione per coerenza tra i due testi.

## Cosa modificare

`src/lib/informativa-privacy.ts`, sezione "Conservazione" (blocco `h2`
+ paragrafi che iniziano con "I file (video, foto, materiali)..." e
"Il registro delle operazioni..."). Aggiungi due nuovi paragrafi, dopo
quelli esistenti e prima (o accanto a) quello sull'immagine/voce già
presente:

1. **Accordo firmato e Modulo di Nomina**: conservati per 10 anni dalla
   cessazione della collaborazione, estendibili per ulteriori periodi
   in presenza della stessa motivazione di rilevanza editoriale o
   documentale che giustifica il mantenimento del contenuto pubblicato
   correlato — non vengono comunque cancellati finché il contenuto a
   cui si riferiscono resta pubblicato, per non restare senza prova del
   consenso su un contenuto ancora online.

2. **Materiali certificati del pacchetto sigillato e archivio PEC**:
   conservati per 10 anni dalla data del sigillo, estendibili di
   ulteriori 5 anni per esigenze di tutela legale (artt. 2946 e 2947
   c.c.).

Testo indicativo, con le citazioni normative già inserite per esteso
(adattalo allo stile del resto del file, ma mantieni i riferimenti
d'articolo così come sono — è la richiesta esplicita del Titolare):

> "L'accordo editoriale firmato e il modulo di nomina, conservati anche
> dopo l'eventuale cessazione della collaborazione e l'anonimizzazione
> del profilo, sono conservati per un periodo di 10 (dieci) anni dalla
> cessazione, estendibile finché il contenuto pubblicato che
> autorizzano rimane online, con le stesse modalità di revisione
> previste per l'immagine e la voce. Il Titolare resta infatti tenuto a
> poter dimostrare in ogni momento la validità del consenso, ai sensi
> degli artt. 5, par. 2, e 7, par. 1, del GDPR, per tutto il tempo in
> cui il contenuto correlato resta pubblicato. I materiali certificati
> del pacchetto sigillato e l'archivio delle comunicazioni PEC sono
> conservati per un periodo di 10 (dieci) anni dalla data del sigillo,
> estendibile di ulteriori 5 (cinque) anni per esigenze di tutela
> legale, ai sensi dell'art. 17, par. 3, lett. e), del GDPR e degli
> artt. 2946 e 2947 del Codice Civile. La previsione di una revisione
> periodica anziché di un termine fisso e definitivo è la modalità di
> conservazione indicata dall'art. 5, par. 1, lett. e), del GDPR e dal
> Considerando 39 dello stesso Regolamento."

## Proposta opzionale — da confermare con Enrico prima di costruirla

Un promemoria admin, stesso pattern già usato per
`notifiche_dovute_art82`: quando un accordo/nomina raggiunge i 10 anni
dalla generazione, compare nel pannello admin come riga da rivedere
("motiva l'estensione o procedi alla cancellazione"), invece di restare
solo una policy scritta senza alcun trigger nel gestionale. Non
implementarla finché Enrico non la conferma esplicitamente — per ora è
solo una proposta annotata qui.

## Nota

Non serve toccare Accordo, Protocollo o Modulo di Nomina in
`public/documenti/`: nessuno dei tre cita un periodo di conservazione
per questi dati — l'Accordo (Art. 7.2) rimanda già all'Informativa
privacy del gestionale per questo genere di clausole.

Il **Documento 2** (Informativa/Liberatoria per i terzi intervistati)
invece l'ho già aggiornato io: aveva lo stesso identico buco — un
periodo di conservazione per l'immagine/voce del terzo (già corretto,
20 anni/revisione ogni 5), ma nessuna menzione di quanto a lungo resti
conservata la liberatoria firmata in sé, la prova del consenso di
quella persona. Ho aggiunto lì lo stesso schema 10+5 anni con le stesse
citazioni, punto "8. Periodo di conservazione dei dati" del documento —
è già in libreria, non serve rifarlo. Copialo per coerenza terminologica
quando scrivi il testo per `informativa-privacy.ts`, così i due testi
(quello per i Collaboratori nel gestionale, quello per i terzi nel
Documento 2) usano la stessa formulazione.
