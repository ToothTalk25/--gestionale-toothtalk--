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
