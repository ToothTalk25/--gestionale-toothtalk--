import "server-only";

/**
 * Integrazione con Google Gemini (API generativelanguage.googleapis.com).
 *
 * L'uso è volutamente minimo: il modello riceve i file direttamente (PDF o
 * fotogrammi) e risponde con una valutazione testuale/JSON. Niente dipendenze
 * esterne: si chiama la REST API con fetch.
 *
 * Tutti i controlli sono di SEGNALAZIONE, mai di blocco: l'IA può sbagliare
 * e la prova legale resta nella PEC.
 */

const MODELLO = "gemini-flash-latest";

function apiKey(): string | null {
  return process.env.GEMINI_API_KEY || null;
}

export function geminiConfigurato(): boolean {
  return apiKey() !== null;
}

type Risposta = { testo: string };

async function genera(prompt: string, parts: { inlineData?: { data: string; mimeType: string }; text?: string }[]) {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY non configurata.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELLO}:generateContent?key=${key}`,
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
 * nel punto giusto. Restituisce sempre un esito: l'IA non blocca nulla.
 */
export async function verificaAccordoFirmato(opts: {
  pdfBase64: string;
  mimeType: string;
}): Promise<EsitoVerificaAccordo> {
  const prompt = [
    "Sei un assistente di controllo documenti. Ti viene mostrato un PDF.",
    "Rispondi SOLO con un JSON senza testo intorno, con questa forma:",
    '{"esito":"ok|attenzione|errato","note":"spiegazione breve in italiano"}',
    "",
    "Criteri:",
    "1. Il documento è un accordo di partecipazione/editoriale ToothTalk? Se non lo è -> errato.",
    "2. C'è una firma manoscritta (non testo stampato) nel riquadro/della firma? Se manca -> errato.",
    "3. La firma è presente ma in un punto inatteso o il documento sembra una bozza non compilata -> attenzione.",
    "4. Se tutto è a posto -> ok.",
  ].join("\n");

  try {
    const risposta = await genera(prompt, [
      { inlineData: { data: opts.pdfBase64, mimeType: opts.mimeType } },
    ]);
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
