import "server-only";

/**
 * Integrazione con Google Gemini (API generativelanguage.googleapis.com).
 *
 * L'uso è volutamente minimo: il modello riceve i file direttamente (PDF o
 * fotogrammi) e risponde con una valutazione testuale/JSON. Niente dipendenze
 * esterne: si chiama la REST API con fetch.
 *
 * verificaAccordoFirmato è di sola segnalazione (la prova legale resta nella
 * PEC). verificaPersoneVideo invece alimenta un blocco reale al sigillo (vedi
 * 0050_riconoscimento_in_sigillo.sql) — è una scelta esplicita per prevenire
 * la pubblicazione di contenuti con terzi non tutelati da liberatoria.
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
 * nel punto giusto. Restituisce sempre un esito: l'IA non blocca nulla.
 * L'accordo è UNO SOLO per tutti i collaboratori (on-screen o backstage):
 * la cessione dei diritti (immagine e autore) è già dentro l'Art. 4 del
 * documento unico, quindi non c'è alcun tipo da distinguere.
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

// ------------------------------------------------------------------ File API (upload resumable)

/**
 * Carica un file (es. video) sulla Gemini File API con upload resumable.
 * Restituisce il fileUri da usare in generateContent come fileData.
 */
export async function caricaFileGemini(buffer: Buffer, mimeType: string): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("GEMINI_API_KEY non configurata.");

  const bytes = new Uint8Array(buffer);
  const size = bytes.byteLength;

  // 1) Start: ottieni l'URL di upload
  // Nota: l'endpoint di upload vive sotto /upload/v1beta/, non sotto
  // BASE_URL (che è già .../v1beta) — concatenarli duplicherebbe "v1beta"
  // nel path e darebbe 404.
  const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${key}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: `upload_${Date.now()}` } }),
  });

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Gemini File API start: HTTP ${startRes.status} ${err}`);
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini File API: x-goog-upload-url mancante");

  // 2) Upload + finalize
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(size),
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Gemini File API upload: HTTP ${uploadRes.status} ${err}`);
  }

  const fileInfo = (await uploadRes.json()) as {
    file?: { uri?: string; name?: string; state?: string };
  };
  if (!fileInfo.file?.uri) throw new Error("Gemini File API: fileUri mancante");
  if (!fileInfo.file.name) throw new Error("Gemini File API: fileName mancante");

  // Polling: il video potrebbe essere in PROCESSING dopo l'upload
  if (fileInfo.file.state !== "ACTIVE") {
    const name = fileInfo.file.name;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`${BASE_URL}/${name}?key=${key}`);
      if (!poll.ok) throw new Error(`Gemini File API poll: HTTP ${poll.status}`);
      const info = (await poll.json()) as { state?: string };
      if (info.state === "ACTIVE") break;
      if (i === 9) throw new Error("File Gemini non pronto in tempo (ancora in PROCESSING dopo 20s)");
    }
  }

  return fileInfo.file.uri;
}

// ------------------------------------------------------------------ Verifica persone video

export type EsitoVerificaPersone = {
  esito: "nessuna_persona_esterna" | "persona_non_riconosciuta" | "errore";
  dettaglio: string;
};

/**
 * Confronta il soggetto principale del video con le foto profilo dei membri
 * del gruppo. Se trova una persona non riconosciuta, segnala.
 */
export async function verificaPersoneVideo(opts: {
  videoBuffer: Buffer;
  videoMimeType: string;
  fotoRiferimento: { profileId: string; base64: string; mimeType: string }[];
}): Promise<EsitoVerificaPersone> {
  try {
    const fileUri = await caricaFileGemini(opts.videoBuffer, opts.videoMimeType);

    const prompt = [
      "Sei un assistente di riconoscimento visivo per un progetto di divulgazione odontoiatrica (ToothTalk).",
      "Riceverai un video e alcune foto di riferimento dei membri noti del team.",
      "",
      "Tuo compito:",
      "1. Identifica il SOGGETTO PRINCIPALE del video (chi parla alla telecamera, chi viene intervistato).",
      "   Escludi ESPLICITAMENTE persone sullo sfondo, passanti, o comparse occasionali.",
      "2. Confronta il soggetto principale con le foto di riferimento.",
      "3. Rispondi SOLO con un JSON:",
      '   {"esito":"nessuna_persona_esterna|persona_non_riconosciuta","dettaglio":"spiegazione in italiano"}',
      "",
      '- "nessuna_persona_esterna" se il soggetto corrisponde a una foto di riferimento',
      '- "persona_non_riconosciuta" se il soggetto NON corrisponde a nessuna foto',
      "- Ignora persone sullo sfondo e passanti.",
    ].join("\n");

    const parts: GeminiPart[] = [
      { fileData: { fileUri, mimeType: opts.videoMimeType } },
      ...opts.fotoRiferimento.map((f) => ({
        inlineData: { data: f.base64, mimeType: f.mimeType },
      })),
    ];

    const risposta = await genera(prompt, parts);
    const jsonMatch = risposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { esito: "errore", dettaglio: "Risposta IA non interpretabile." };

    const parsed = JSON.parse(jsonMatch[0]) as Partial<EsitoVerificaPersone>;
    const esito =
      parsed.esito === "nessuna_persona_esterna" || parsed.esito === "persona_non_riconosciuta"
        ? parsed.esito : "errore";

    return { esito, dettaglio: parsed.dettaglio ?? "Nessun dettaglio." };
  } catch (e) {
    return {
      esito: "errore",
      dettaglio: e instanceof Error ? e.message : "Errore imprevisto.",
    };
  }
}

/**
 * Stessa verifica di verificaPersoneVideo, ma su un'immagine statica (la
 * copertina). Un'immagine di copertina resta pubblicata quanto il video: se
 * ritrae una persona esterna non dichiarata va bloccata allo stesso modo.
 * Nessuna File API: un'immagine di copertina è piccola, va bene inlineData.
 */
export async function verificaPersoneImmagine(opts: {
  immagineBase64: string;
  mimeType: string;
  fotoRiferimento: { profileId: string; base64: string; mimeType: string }[];
}): Promise<EsitoVerificaPersone> {
  try {
    const prompt = [
      "Sei un assistente di riconoscimento visivo per un progetto di divulgazione odontoiatrica (ToothTalk).",
      "Riceverai l'immagine di copertina di un video e alcune foto di riferimento dei membri noti del team.",
      "",
      "Tuo compito:",
      "1. Identifica il SOGGETTO PRINCIPALE dell'immagine (la persona ritratta in primo piano, protagonista della copertina).",
      "   Escludi persone sullo sfondo o comparse marginali.",
      "2. Confronta il soggetto principale con le foto di riferimento.",
      "3. Rispondi SOLO con un JSON:",
      '   {"esito":"nessuna_persona_esterna|persona_non_riconosciuta","dettaglio":"spiegazione in italiano"}',
      "",
      '- "nessuna_persona_esterna" se il soggetto corrisponde a una foto di riferimento, o se nell\'immagine non compare alcuna persona riconoscibile in primo piano',
      '- "persona_non_riconosciuta" se il soggetto NON corrisponde a nessuna foto',
    ].join("\n");

    const parts: GeminiPart[] = [
      { inlineData: { data: opts.immagineBase64, mimeType: opts.mimeType } },
      ...opts.fotoRiferimento.map((f) => ({
        inlineData: { data: f.base64, mimeType: f.mimeType },
      })),
    ];

    const risposta = await genera(prompt, parts);
    const jsonMatch = risposta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { esito: "errore", dettaglio: "Risposta IA non interpretabile." };

    const parsed = JSON.parse(jsonMatch[0]) as Partial<EsitoVerificaPersone>;
    const esito =
      parsed.esito === "nessuna_persona_esterna" || parsed.esito === "persona_non_riconosciuta"
        ? parsed.esito : "errore";

    return { esito, dettaglio: parsed.dettaglio ?? "Nessun dettaglio." };
  } catch (e) {
    return {
      esito: "errore",
      dettaglio: e instanceof Error ? e.message : "Errore imprevisto.",
    };
  }
}
