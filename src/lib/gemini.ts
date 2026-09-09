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

const MODELLO = "gemini-flash-latest";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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

async function genera(prompt: string, parts: GeminiPart[]): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY non configurata.");

  const res = await fetch(
    `${BASE_URL}/models/${MODELLO}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      }),
    },
  );

  const data = (await res.json()) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };

  if (!res.ok) {
    throw new Error(data?.error?.message ?? "Errore di chiamata a Gemini");
  }

  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
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
    const risposta = await genera(prompt, parti);
    const jsonMatch = risposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { esito: "non_valutato", note: "Risposta IA non interpretabile." };
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
  /**
   * Risposta automatica, solo se categoria === "tecnica" — viene mostrata SUBITO
   * al collaboratore nel widget chat, senza revisione del Coordinatore prima
   * dell'invio (decisione esplicita: la classificazione stessa è il controllo).
   * Per questo il prompt sotto è deliberatamente restrittivo su cosa conta
   * "tecnica": solo meccanica generica dell'app, mai nulla che riguardi lo
   * stato specifico di una persona.
   */
  bozza: string | null;
};

const CONTESTO_GESTIONALE = [
  "Il Gestionale ToothTalk è lo strumento interno del progetto di divulgazione",
  "odontoiatrica ToothTalk (canale YouTube), usato dai collaboratori nei vari",
  "poli universitari per lavorare ai video. Funzioni principali:",
  "- Registrazione con codice di invito del polo, poi attesa di approvazione del Coordinatore.",
  "- Firma dell'Accordo Editoriale (cessione diritti) come condizione per accedere ai progetti.",
  "- Ogni progetto/task ha materiali da caricare: script, copertina, video, eventuale liberatoria",
  "  per persone esterne che compaiono nel video.",
  "- Il pacchetto va 'sigillato' quando completo: dopo il sigillo diventa immutabile.",
  "- Se richiesta una liberatoria, la persona esterna firma con un codice OTP ricevuto via email.",
  "- L'app è installabile come PWA (icona sulla schermata Home) su iPhone/Android/Mac/Windows.",
  "- Requisiti tecnici comuni: serve una connessione internet stabile per l'upload dei video",
  "  (file grandi); il caricamento avviene dal browser, Safari su iPhone o Chrome altrove.",
].join("\n");

/**
 * Classifica una domanda di un collaboratore (widget chat) e, se è di tipo
 * tecnico in senso stretto, prepara una risposta che viene mandata SUBITO
 * al collaboratore, senza revisione umana — per questo la definizione di
 * "tecnica" nel prompt è volutamente stretta: solo meccanica generica
 * dell'app (come si fa X, dov'è Y), mai nulla che presupponga di sapere
 * qualcosa sullo stato specifico di questa persona (il Coordinatore vede
 * comunque tutte le domande, incluse quelle risposte in automatico, e il
 * collaboratore ha sempre un tasto per chiedere lui/lei direttamente).
 * Mai bloccante: in caso di errore o risposta non interpretabile, ricade
 * su "altro" — meglio lasciare che risponda una persona piuttosto che
 * rischiare una risposta sbagliata o inventata mandata da sola.
 */
export async function classificaDomandaSupporto(domanda: string): Promise<EsitoDomandaSupporto> {
  const prompt = [
    "Sei l'assistente automatico del Gestionale ToothTalk, dentro un widget chat.",
    "Se classifichi una domanda come tecnica, la tua risposta viene mandata SUBITO",
    "al collaboratore, senza che nessuno la controlli prima. Devi quindi essere",
    "molto prudente: nel dubbio classifica sempre come \"altro\".",
    "",
    "Contesto (tutto ciò che sai, non inventare nulla oltre questo):",
    CONTESTO_GESTIONALE,
    "",
    "Un collaboratore ha scritto questa domanda:",
    `"""${domanda}"""`,
    "",
    "Classificala \"tecnica\" SOLO se riguarda la meccanica generica dell'app — come si fa",
    "un'azione, dove si trova qualcosa, come installare l'app, un errore tecnico generico",
    "— e puoi rispondere con certezza usando SOLO il contesto sopra.",
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
    "La bozza, quando la scrivi, deve restare generica e istruttiva (spiegare un procedimento),",
    "mai affermare fatti su questo specifico utente o sul suo account.",
    "",
    "Rispondi SOLO con un JSON senza testo intorno, con questa forma:",
    '{"categoria":"tecnica|altro","bozza":"risposta breve e utile in italiano, o null se categoria è altro"}',
  ].join("\n");

  try {
    const risposta = await genera(prompt, []);
    const jsonMatch = risposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { categoria: "altro", bozza: null };
    const parsed = JSON.parse(jsonMatch[0]) as Partial<EsitoDomandaSupporto>;
    if (parsed.categoria !== "tecnica") return { categoria: "altro", bozza: null };
    return {
      categoria: "tecnica",
      bozza: typeof parsed.bozza === "string" && parsed.bozza.trim() ? parsed.bozza.trim() : null,
    };
  } catch {
    return { categoria: "altro", bozza: null };
  }
}
