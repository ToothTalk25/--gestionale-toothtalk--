/**
 * Testo dell'informativa privacy del gestionale, adattato dal Documento 2
 * (Informativa e Liberatoria per interviste) rimuovendo i riferimenti a chi
 * viene intervistato: qui il soggetto è chi usa il gestionale come
 * Collaboratore, non un terzo intervistato da altri. Unico punto dove
 * cambiare il testo se l'informativa viene aggiornata di nuovo.
 */

export type Blocco =
  | { tipo: "h2"; testo: string }
  | { tipo: "p"; testo: string }
  | { tipo: "ul"; voci: string[] };

const p = (testo: string): Blocco => ({ tipo: "p", testo });
const h2 = (testo: string): Blocco => ({ tipo: "h2", testo });
const ul = (voci: string[]): Blocco => ({ tipo: "ul", voci });

export const INFORMATIVA_PRIVACY: Blocco[] = [
  h2("Titolare del trattamento"),
  p("Il Titolare del trattamento è Enrico Maria Guarino, in qualità di titolare del progetto editoriale “Tooth Talk™”, con sede in Via Bozzano n.11 16143 Genova, C.F. GRNNCM05H20C342W. E-mail: enricoguarino25@gmail.com. PEC: enricomariaguarino@postecertifica.it."),

  h2("Responsabile della protezione dei dati (DPO)"),
  p("Non è stato designato un Responsabile della protezione dei dati, in quanto il trattamento non rientra nelle ipotesi di cui all'art. 37 del Regolamento UE 2016/679 (GDPR). Per qualsiasi questione relativa al trattamento dei dati personali, è possibile contattare il Titolare all'indirizzo email o PEC indicati sopra."),

  h2("Quali dati trattiamo"),
  ul([
    "Dati anagrafici essenziali: nome, cognome, email, università;",
    "Data di nascita, luogo di nascita e codice fiscale: raccolti esclusivamente per compilare il Modulo di nomina a persona autorizzata al trattamento (Documento 4, art. 29 GDPR), generato automaticamente all'approvazione dell'accordo;",
    "Foto del profilo;",
    "Accordo editoriale firmato (PDF): è un unico documento per tutti i Collaboratori, on-screen o dietro le quinte — per chi appare nei contenuti, la cessione dei diritti di immagine e voce è già inclusa nell'accordo stesso, non in un documento separato;",
    "Modulo di nomina a persona autorizzata al trattamento (Documento 4), generato automaticamente dal gestionale all'approvazione dell'accordo;",
    "Immagine, voce e dichiarazioni contenute nei video, script e materiali depositati nel gestionale;",
    "Esito e note della verifica automatica (IA) sull'accordo caricato;",
    "Indicazione se il Collaboratore appare nei contenuti pubblicati o lavora dietro le quinte;",
    "Riferimento a chi, tra gli account del Titolare, ha approvato la registrazione e l'accordo;",
    "Dati tecnici di connessione (indirizzo IP, dispositivo, data e ora) e log delle operazioni.",
  ]),
  p("Immagine e voce non sono soggette ad alcun trattamento automatizzato di riconoscimento o confronto facciale: nessun sistema del gestionale confronta i volti presenti nei contenuti con le foto profilo del team."),

  h2("Finalità e base giuridica"),
  ul([
    "Esecuzione dell'accordo (art. 6.1.b GDPR): organizzare la partecipazione dei gruppi universitari, gestire l'account e la collaborazione, ricevere e conservare l'accordo firmato, il caricamento della foto del profilo e dei materiali prodotti;",
    "Obbligo connesso all'esecuzione dell'accordo (art. 6.1.b GDPR): trattamento di data di nascita, luogo di nascita e codice fiscale, strettamente limitato alla formalizzazione della nomina a persona autorizzata al trattamento (Documento 4, art. 29 GDPR e art. 2-quaterdecies Codice Privacy) conseguente all'approvazione dell'accordo;",
    "Consenso (art. 6.1.a GDPR): registrazione, pubblicazione e diffusione dell'immagine, della voce e delle dichiarazioni per chi compare nei contenuti pubblicati — revocabile in ogni momento senza conseguenze sulla partecipazione al Progetto;",
    "Interesse legittimo (art. 6.1.f GDPR): tutela legale del contenuto attraverso la certificazione via PEC e il registro append-only.",
  ]),
  p("Pubblicazione e diffusione dei contenuti su canali nazionali, europei e internazionali, ivi inclusi, a titolo esemplificativo e non esaustivo: sito web, piattaforme social (Instagram, Facebook, LinkedIn, YouTube), podcast, newsletter, pubblicazioni cartacee e digitali, e ogni altra forma di comunicazione presente e futura."),

  h2("Destinatari dei dati e trasferimento extra-UE"),
  p("I dati personali potranno essere comunicati ad altri Collaboratori e volontari del Progetto che partecipano alla realizzazione dei contenuti editoriali (in qualità di persone autorizzate, art. 29 GDPR) e a fornitori di servizi tecnici e piattaforme digitali (hosting, cloud storage), in qualità di responsabili del trattamento."),
  p("Il documento dell'accordo editoriale caricato (contenente nome, indirizzo, codice fiscale e firma) viene inoltre inviato a Google (API Gemini) per la verifica automatica di corrispondenza con il modello ufficiale — un trattamento specifico e distinto dal semplice hosting, limitato a questa finalità."),
  p("Trasferimento extra-UE: i contenuti pubblicati sono diffusi anche su piattaforme social le cui società madri hanno sede negli Stati Uniti (Meta, Google), che operano come titolari autonomi del trattamento per i dati elaborati sulle rispettive piattaforme. Tali trasferimenti si basano sulle garanzie adeguate previste dal GDPR, incluso il Data Privacy Framework UE-USA e/o le clausole contrattuali standard (SCC)."),

  h2("Conservazione"),
  p("I file (video, foto, materiali) restano sulla piattaforma solo il tempo necessario a scaricarli e pubblicarli, e possono essere eliminati dopo l'invio della PEC. I metadati, le impronte e i verbali PEC restano come registro append-only per esigenze di tutela legale, insieme alla copia già presente nella casella PEC e nelle caselle dei partecipanti. Una copia dei materiali sigillati e del relativo verbale viene inoltre archiviata su Google Drive, in una cartella riservata al progetto e accessibile solo al Coordinatore."),
  p("Il registro delle operazioni (log di chi ha fatto cosa, quando, su quale progetto) è conservato a tempo indeterminato, per finalità di tutela legale (art. 6.1.f GDPR): è un registro append-only, non modificabile né cancellabile nemmeno dal Titolare."),
  p("L'accordo editoriale firmato e il modulo di nomina, conservati anche dopo l'eventuale cessazione della collaborazione e l'anonimizzazione del profilo, sono conservati per un periodo di 10 (dieci) anni dalla cessazione, estendibile finché il contenuto pubblicato che autorizzano rimane online, con le stesse modalità di revisione previste per l'immagine e la voce. Il Titolare resta infatti tenuto a poter dimostrare in ogni momento la validità del consenso, ai sensi degli artt. 5, par. 2, e 7, par. 1, del GDPR, per tutto il tempo in cui il contenuto correlato resta pubblicato."),
  p("I materiali certificati del pacchetto sigillato e l'archivio delle comunicazioni PEC sono conservati per un periodo di 10 (dieci) anni dalla data del sigillo, estendibile di ulteriori 5 (cinque) anni per esigenze di tutela legale, ai sensi dell'art. 17, par. 3, lett. e), del GDPR e degli artt. 2946 e 2947 del Codice Civile. La previsione di una revisione periodica anziché di un termine fisso e definitivo è la modalità di conservazione indicata dall'art. 5, par. 1, lett. e), del GDPR e dal Considerando 39 dello stesso Regolamento."),
  p("Per l'immagine e la voce di chi appare nei contenuti pubblicati: conservazione per un periodo massimo di 20 (venti) anni dalla data di pubblicazione, con revisione almeno ogni 5 (cinque) anni per valutare se il contenuto mantenga un interesse editoriale/documentale. In assenza di una motivazione scritta di rilevanza storica, culturale o scientifica, i dati vengono cancellati allo scadere del quinto anno."),

  h2("Chi vede i tuoi dati"),
  p("L'anagrafica completa è visibile solo a te e al Coordinatore del progetto. Gli altri partecipanti del gruppo vedono solo il tuo nome. I materiali depositati sono visibili ai partecipanti del tuo gruppo e al Coordinatore."),

  h2("I tuoi diritti"),
  p("Hai diritto di esercitare i seguenti diritti nei confronti del Titolare del trattamento:"),
  ul([
    "Accesso (art. 15 GDPR): ottenere la conferma che sia o meno in corso un trattamento di dati personali che ti riguardano e, in tal caso, ottenere l'accesso ai dati e alle informazioni;",
    "Rettifica (art. 16 GDPR): ottenere la rettifica dei dati personali inesatti;",
    "Cancellazione (art. 17 GDPR): ottenere la cancellazione dei dati personali, nei casi previsti dalla legge;",
    "Limitazione (art. 18 GDPR): ottenere la limitazione del trattamento nei casi previsti dalla legge;",
    "Opposizione (art. 21 GDPR): opporti in qualsiasi momento al trattamento per motivi connessi alla tua situazione particolare;",
    "Portabilità (art. 20 GDPR): ricevere in un formato strutturato, di uso comune e leggibile i dati che ti riguardano;",
    "Revoca del consenso (art. 7 GDPR): revocare il consenso in qualsiasi momento, senza pregiudicare la liceità del trattamento basata sul consenso prima della revoca;",
    "Proporre reclamo all'Autorità Garante per la protezione dei dati personali (www.garanteprivacy.it).",
  ]),
  p("Per esercitarli, scrivi a enricoguarino25@gmail.com o, per la certificazione di consegna, alla PEC enricomariaguarino@postecertifica.it."),

  h2("Consenso per chi appare nei contenuti"),
  p("Se il Collaboratore compare, con la propria immagine, voce e/o nome, nei contenuti realizzati nell'ambito del Progetto, prende atto e acconsente che:"),
  ul([
    "i contenuti potranno essere registrati, riprodotti, distribuiti, comunicati al pubblico e diffusi sui canali del Progetto;",
    "i contenuti potranno essere modificati, montati, adattati e integrati con altri materiali, nel rispetto della finalità editoriale del Progetto;",
    "non è previsto alcun compenso o rimborso spese, né un diritto di controllo preventivo sui contenuti editati.",
  ]),
  p("Le dichiarazioni rese nei contenuti sono di esclusiva responsabilità di chi le rende: il Collaboratore dichiara che le proprie dichiarazioni sono veritiere, accurate e non diffamatorie nei confronti di terzi, e si impegna a manlevare e tenere indenne il Progetto da qualsiasi pretesa di terzi al riguardo, fatta salva l'ipotesi di montaggio palesemente manipolatorio da parte del Progetto che ne stravolga il senso."),
  p("Revoca del consenso: sempre possibile in qualsiasi momento, senza obbligo di indicarne il motivo, tramite l'apposita funzione di revoca nel proprio profilo del gestionale (che costituisce comunicazione scritta a tutti gli effetti) oppure scrivendo a enricoguarino25@gmail.com o alla PEC enricomariaguarino@postecertifica.it — non pregiudica la liceità del trattamento basata sul consenso prima della revoca. La revoca comporta l'individuazione e la cancellazione, da parte del Coordinatore, del materiale grezzo non pubblicato che ti ritrae, entro 30 (trenta) giorni dalla revoca — non è una cancellazione automatica: il sistema registra chi ha caricato un file, non chi vi compare, quindi la verifica di quali file eliminare è sempre umana; non comporta invece, di per sé, la rimozione dei contenuti già pubblicati, salvo richiesta esplicita in tal senso. Richieste di rimozione di un contenuto già pubblicato sono valutate caso per caso, alla luce delle finalità editoriali del Progetto e delle eccezioni di cui all'art. 17, par. 3, GDPR (libertà di espressione e informazione), con risposta entro 30 (trenta) giorni, prorogabile a 90 (novanta) giorni con motivazione scritta."),

  h2("Obbligo di fornitura dei dati"),
  p("Il conferimento dei dati anagrafici essenziali (nome, cognome, email, università) e della foto del profilo è necessario per la gestione amministrativa dell'account e della collaborazione: il loro mancato conferimento comporta l'impossibilità di accedere al gestionale e di partecipare al Progetto come Collaboratore. Il consenso alla comparizione con la propria immagine, voce e/o dichiarazioni nei contenuti pubblicati (di cui alla sezione “Consenso per chi appare nei contenuti”) è invece facoltativo e indipendente: il relativo rifiuto o la successiva revoca non pregiudicano in alcun modo la possibilità di partecipare al Progetto per le attività che non comportano la comparizione nei contenuti pubblicati."),
];
