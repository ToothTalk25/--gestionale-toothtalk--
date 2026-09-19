import "server-only";

/**
 * Integrazione con Google Gemini (API generativelanguage.googleapis.com).
 *
 * L'uso è volutamente minimo: il modello riceve il PDF dell'accordo
 * direttamente e risponde con una valutazione testuale/JSON. Niente
 * dipendenze esterne: si chiama la REST API con fetch.
 *
 * verificaAccordoFirmato è di sola segnalazione (la prova legale resta
 * nella PEC): l'esito IA non blocca nulla da solo, serve insieme
 * all'approvazione manuale del Titolare.
 *
 * Il confronto automatico dei volti (video/copertina contro le foto
 * profilo del team) è stato rimosso dal codice — non solo disattivato —
 * dopo l'audit GDPR che ha rilevato un conflitto con l'Informativa
 * privacy (dichiarava assente ogni trattamento automatizzato di
 * riconoscimento facciale, mentre questa funzione lo effettuava). Vedi
 * la migrazione che ha rimosso il relativo blocco al sigillo.
 */

/**
 * Modelli usati, in ordine.
 *
 * Il primo è un modello STABILE, non l'alias "gemini-flash-latest": l'alias
 * viene ricambiato a ogni rilascio e finisce per puntare a un modello appena
 * uscito, cioè a quello con più coda di tutti. È la causa reale del "This
 * model is currently experiencing high demand" visto in produzione il 18
 * settembre 2026 — il giorno dopo il rilascio di Gemini 3.8, a cui l'alias
 * era stato agganciato. Serve leggere due PDF e confrontare clausole: un
 * modello flash recente è la scelta giusta, uno "lite" no (costerebbe meno ma
 * questa non è una richiesta banale).
 * Il secondo resta come ripiego se il primo rifiuta.
 */
const MODELLI = ["gemini-3.5-flash", "gemini-3.6-flash"];
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Attesa prima di ritentare lo stesso modello (ms): il caso tipico è una coda di pochi secondi. */
const ATTESE_RIPROVA = [2000];

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

export function geminiConfigurato(): boolean {
  return apiKey() !== null;
}

type GeminiPart = {
  inlineData?: { data: string; mimeType: string };
  fileData?: { fileUri: string; mimeType: string };
  text?: string;
};

/**
 * Chiama Gemini e ritorna il testo della risposta.
 *
 * Ritenta quando l'errore è TRANSITORIO (sovraccarico 429/500/503, oppure
 * rete): il modello risponde "high demand, try again later" per pochi
 * secondi, e senza riprova un accordo vero resterebbe 'non_valutato' —
 * quindi invisibile nella coda di approvazione — per un guasto che si
 * sarebbe risolto da solo (visto davvero: il primo tentativo della
 * rivalutazione è caduto su un 503 di sovraccarico).
 * Sui veri errori (chiave non valida, richiesta rifiutata) si ferma subito:
 * ritentare non cambierebbe l'esito e farebbe perdere secondi utili.
 */
async function genera(prompt: string, parts: GeminiPart[], opts: { json?: boolean } = {}): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY non configurata.");

  let ultimoErrore: Error | null = null;

  for (let i = 0; i < MODELLI.length; i++) {
    const modello = MODELLI[i];
    // Un tentativo per modello; sul primo anche una riprova ravvicinata.
    const tentativi = i === 0 ? ATTESE_RIPROVA.length + 1 : 1;

    for (let tentativo = 0; tentativo < tentativi; tentativo++) {
      if (tentativo > 0) {
        await new Promise((r) => setTimeout(r, ATTESE_RIPROVA[tentativo - 1]));
      }

      // Un guasto di rete e un errore HTTP si trattano allo stesso modo: anche
      // il primo può essere transitorio, e per chi chiama non cambia nulla.
      let esito: { ok: boolean; status: number; testo: string; errore: string | null };
      try {
        const res = await fetch(
          `${BASE_URL}/models/${modello}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
              generationConfig: {
                temperature: 0,
                // 1024 token bastavano quando il modello rispondeva e basta: con i
                // modelli che "pensano" prima di rispondere, il ragionamento mangia
                // lo stesso budget e la risposta visibile resta VUOTA (visto: due
                // verifiche su un accordo vero finite in "risposta non
                // interpretabile", cioè nessun JSON da leggere).
                maxOutputTokens: 8192,
                // Dove serve un JSON, lo si chiede come formato: così non dipende
                // dal fatto che il modello decida di scriverlo.
                ...(opts.json ? { responseMimeType: "application/json" } : {}),
              },
            }),
          },
        );

        const data = (await res.json()) as {
          error?: { message?: string };
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };

        esito = {
          ok: res.ok,
          status: res.status,
          testo: data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
          errore: data?.error?.message ?? null,
        };
      } catch (e) {
        esito = {
          ok: false,
          status: 0,
          testo: "",
          errore: e instanceof Error ? e.message : "Errore di rete verso Gemini",
        };
      }

      if (esito.ok) return esito.testo;

      // Il nome del modello entra nel messaggio: senza, la nota che l'admin
      // legge nel pannello non direbbe quale modello ha rifiutato.
      ultimoErrore = new Error(
        `modello ${modello}: ${esito.errore ?? "errore di chiamata a Gemini"}`,
      );
      const transitorio =
        esito.status === 0 || esito.status === 429 || esito.status === 500 || esito.status === 503;
      if (!transitorio) throw ultimoErrore;
    }
  }

  throw ultimoErrore ?? new Error("Errore di chiamata a Gemini");
}

export type EsitoVerificaAccordo = {
  esito: "ok" | "attenzione" | "errato" | "non_valutato";
  note: string;
};

/**
 * Verifica che il PDF caricato sia l'accordo editoriale ToothTalk, firmato
 * nel punto giusto E sostanzialmente identico al MODELLO ufficiale attivo
 * (confronto delle clausole, non solo "sembra un accordo"). Restituisce
 * sempre un esito: l'IA non blocca nulla — ma solo un esito 'ok' (insieme
 * all'approvazione manuale del Titolare) sblocca l'accesso ai progetti.
 * L'accordo è UNO SOLO per tutti i collaboratori (on-screen o backstage).
 */
export async function verificaAccordoFirmato(opts: {
  pdfBase64: string;
  mimeType: string;
  modelloBase64?: string;
  modelloMimeType?: string;
}): Promise<EsitoVerificaAccordo> {
  const prompt = [
    "Sei un assistente di controllo documenti.",
    "Ti vengono mostrati due PDF:",
    "  (1) il MODELLO ufficiale dell'accordo ToothTalk;",
    "  (2) un documento caricato da un collaboratore che dichiara di essere quell'accordo firmato.",
    "Rispondi SOLO con un JSON senza testo intorno, con questa forma:",
    '{"esito":"ok|attenzione|errato","note":"spiegazione breve in italiano"}',
    "",
    "Criteri:",
    "1. Confronta il testo SOSTANZIALE delle clausole (non la formattazione) tra i due documenti.",
    "   Se il contenuto delle clausole del documento (2) è stato alterato rispetto al modello (1)",
    "   — anche se visivamente identico — l'esito è 'errato'.",
    "2. Se il documento (2) non è riconducibile al modello (1), l'esito è 'errato'.",
    "3. Se manca una firma manoscritta (non testo stampato), l'esito è 'errato'.",
    "4. Se tutto corrisponde ed è firmato, l'esito è 'ok'.",
    "5. Solo se la firma c'è ma in un punto inatteso, o il documento sembra una bozza non compilata, 'attenzione'.",
  ].join("\n");

  try {
    const parti: { inlineData: { data: string; mimeType: string } }[] = [
      { inlineData: { data: opts.pdfBase64, mimeType: opts.mimeType } },
    ];
    // Se c'è il modello di riferimento, lo passiamo come secondo PDF.
    if (opts.modelloBase64) {
      parti.push({
        inlineData: {
          data: opts.modelloBase64,
          mimeType: opts.modelloMimeType ?? "application/pdf",
        },
      });
    }
    const risposta = await genera(prompt, parti, { json: true });
    const jsonMatch = risposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // La risposta si conserva nella nota: "non interpretabile" da solo non
      // dice niente a chi legge, e senza sapere che cosa ha risposto il modello
      // l'unica strada è ritentare alla cieca (è quello che è successo).
      const vista = risposta.trim().replace(/\s+/g, " ").slice(0, 200);
      return {
        esito: "non_valutato",
        note: vista
          ? `Risposta IA non interpretabile. Il modello ha risposto: «${vista}»`
          : "Risposta IA non interpretabile (il modello non ha scritto nulla: probabile risposta tagliata o bloccata).",
      };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Partial<EsitoVerificaAccordo>;
    const esito =
      parsed.esito === "ok" || parsed.esito === "attenzione" || parsed.esito === "errato"
        ? parsed.esito
        : "non_valutato";
    return { esito, note: parsed.note ?? "" };
  } catch (e) {
    return {
      esito: "non_valutato",
      note: e instanceof Error ? e.message : "Errore imprevisto durante la verifica.",
    };
  }
}

export type EsitoDomandaSupporto = {
  categoria: "tecnica" | "altro";
};

const CONTESTO_GESTIONALE = [
  "Il Gestionale ToothTalk è lo strumento interno del progetto di divulgazione",
  "odontoiatrica ToothTalk (canale YouTube), usato dai collaboratori nei vari",
  "poli universitari per lavorare ai video. Funzioni e navigazione:",
  "- Registrazione con codice di invito del polo, poi attesa di approvazione del Coordinatore.",
  "- Firma dell'Accordo Editoriale (cessione diritti) come condizione per accedere ai progetti.",
  "- Creare un nuovo progetto: si entra nella pagina del proprio polo (in alto, tra i poli visibili",
  "  nella barra di navigazione) e si clicca il pulsante '+ Nuovo progetto'; si compila titolo del",
  "  video, formato e gli altri campi del modulo che appare.",
  "- Ogni progetto/task ha materiali da caricare (dalla sua pagina dedicata): script, copertina,",
  "  video, eventuale liberatoria per persone esterne che compaiono nel video.",
  "- Il pacchetto va 'sigillato' quando completo: dopo il sigillo diventa immutabile.",
  "- Se richiesta una liberatoria, la persona esterna firma con un codice OTP ricevuto via email.",
  "- 'I miei progetti' e la panoramica dei poli sono nella Dashboard (raggiungibile dal logo in",
  "  alto a sinistra o dal menu con nome utente in alto a destra, voce 'Progetti').",
  "- L'app è installabile come PWA (icona sulla schermata Home) su iPhone/Android/Mac/Windows.",
  "- Requisiti tecnici comuni: serve una connessione internet stabile per l'upload dei video",
  "  (file grandi); il caricamento avviene dal browser, Safari su iPhone o Chrome altrove.",
].join("\n");

/**
 * Classifica una domanda di un collaboratore (widget chat) e la smista:
 * "tecnica" se riguarda la meccanica generica dell'app (come si fa X, dov'è Y)
 * — in quel caso la vede e risponde il Collaboratore Tecnico dalla sua pagina
 * /tecnico — altrimenti "altro", e la domanda va al Coordinatore.
 *
 * NON scrive mai testo destinato a una persona: la risposta la scrive sempre
 * una persona. Questa funzione restituisce soltanto l'etichetta di smistamento,
 * e l'eventuale bozza che il modello producesse viene ignorata. Fino al
 * 19/09/2026 il commento qui sotto descriveva un invio automatico al
 * collaboratore: era il comportamento precedente al 16/09/2026, quando il
 * Collaboratore Tecnico non aveva ancora un accesso proprio. Il codice non lo
 * fa più (e con 0 righe in domande_supporto, di fatto non è mai accaduto).
 *
 * Per questo la definizione di "tecnica" nel prompt è volutamente stretta:
 * mai nulla che presupponga di sapere qualcosa sullo stato specifico di questa
 * persona. Mai bloccante: in caso di errore o risposta non interpretabile
 * ricade su "altro" — meglio lasciare che risponda una persona.
 */
export async function classificaDomandaSupporto(domanda: string): Promise<EsitoDomandaSupporto> {
  const prompt = [
    "Sei il sistema automatico del Gestionale ToothTalk che smista le domande di supporto.",
    "Il tuo unico compito è decidere a chi va la domanda. Non scrivere nessuna risposta:",
    "a rispondere è sempre una persona, il Collaboratore Tecnico o il Coordinatore.",
    "Devi quindi essere molto prudente: nel dubbio classifica sempre come \"altro\".",
    "",
    "Contesto (tutto ciò che sai, non inventare nulla oltre questo):",
    CONTESTO_GESTIONALE,
    "",
    "Un collaboratore ha scritto questa domanda:",
    `"""${domanda}"""`,
    "",
    "Classificala \"tecnica\" SOLO se riguarda la meccanica generica dell'app — come si fa",
    "un'azione, dove si trova qualcosa, come installare l'app, un errore tecnico generico",
    "— e il contesto sopra è sufficiente per rispondere (non serve sapere altro).",
    "",
    "Classificala SEMPRE \"altro\" (nessuna eccezione) se la domanda:",
    "- riguarda lo stato specifico di QUESTA persona (se è stata approvata, a che punto è",
    "  il suo accordo, le sue scadenze, se un suo materiale va bene) — non hai questi dati,",
    "  quindi qualunque risposta sarebbe inventata;",
    "- chiede una valutazione, un'eccezione, un permesso, o un giudizio sul suo lavoro;",
    "- riguarda il processo editoriale, decisioni del Coordinatore, o questioni personali;",
    "- ha qualsiasi implicazione legale, di scadenza, di consenso GDPR o economica;",
    "- non è chiaramente riconducibile a un punto preciso del contesto sopra.",
    "",
    "Rispondi SOLO con un JSON senza testo intorno, con questa forma:",
    '{"categoria":"tecnica|altro"}',
  ].join("\n");

  try {
    const risposta = await genera(prompt, [], { json: true });
    const jsonMatch = risposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { categoria: "altro" };
    const parsed = JSON.parse(jsonMatch[0]) as Partial<EsitoDomandaSupporto>;
    if (parsed.categoria !== "tecnica") return { categoria: "altro" };
    return { categoria: "tecnica" };
  } catch {
    return { categoria: "altro" };
  }
}
