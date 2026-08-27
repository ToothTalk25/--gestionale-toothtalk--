import "server-only";

/**
 * Legge il contenuto testuale di un Google Doc pubblico/condiviso
 * usando l'OAuth refresh token dell'account ToothTalk.
 */

async function tokenGoogle(): Promise<string> {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error("Credenziali OAuth Google assenti.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Token OAuth: HTTP ${res.status}`);
  const d = (await res.json()) as { access_token?: string };
  if (!d.access_token) throw new Error("Token OAuth: access_token mancante");
  return d.access_token;
}

/**
 * Estrae l'ID del documento da un URL Google Doc.
 * Formati accettati: /document/d/{id}/edit, /document/d/{id}/...
 */
function estraiId(url: string): string | null {
  const m = url.match(/\/document\/[du]\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

/**
 * Scarica il contenuto testuale di un Google Doc.
 * Richiede che il documento sia condiviso con l'account ToothTalk.
 */
export async function leggiTestoGoogleDoc(
  url: string,
): Promise<{ ok: true; testo: string } | { ok: false; errore: string }> {
  try {
    const docId = estraiId(url);
    if (!docId) return { ok: false, errore: "Link Google Doc non valido." };

    const token = await tokenGoogle();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (res.status === 403) {
      return {
        ok: false,
        errore:
          "Il documento non è condiviso con l'account Google di ToothTalk (tooth.talk25@gmail.com) — condividilo e riprova.",
      };
    }
    if (res.status === 404) {
      return { ok: false, errore: "Documento non trovato: verifica che il link sia corretto." };
    }
    if (!res.ok) {
      return { ok: false, errore: `Errore Google Drive: HTTP ${res.status}` };
    }

    const testo = await res.text();
    return { ok: true, testo };
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : "Errore di rete." };
  }
}


// ------------------------------------------------------------------ Drive helpers

async function df(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}

async function trovaOCreaCartella(token: string, parentId: string, nome: string): Promise<string> {
  const q = `'${parentId}' in parents and name='${nome.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const r = await df(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (!r.ok) throw new Error(`Cerca cartella '${nome}': HTTP ${r.status}`);
  const j = (await r.json()) as { files?: { id: string }[] };
  if (j.files?.length) return j.files[0].id;

  const c = await df(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nome, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!c.ok) throw new Error(`Crea cartella '${nome}': HTTP ${c.status}`);
  const nj = (await c.json()) as { id: string };
  return nj.id;
}

/** Crea un Google Doc vuoto, lo condivide con chiunque abbia il link (writer) e restituisce id+url. */
export async function creaGoogleDocLavorazione(
  titoloProgetto: string,
  suffisso: string,
  cartellaId: string,
): Promise<{ id: string; url: string }> {
  const token = await tokenGoogle();
  const nome = `${titoloProgetto} — ${suffisso}`;

  const r = await df(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nome, mimeType: "application/vnd.google-apps.document", parents: [cartellaId] }),
  });
  if (!r.ok) throw new Error(`Crea Google Doc '${nome}': HTTP ${r.status}`);
  const doc = (await r.json()) as { id: string };
  const docId = doc.id;

  // Condividi con chiunque abbia il link (writer)
  await df(token, `https://www.googleapis.com/drive/v3/files/${docId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "writer", type: "anyone" }),
  }).catch(() => {});

  return { id: docId, url: `https://docs.google.com/document/d/${docId}/edit` };
}

/** Crea i 3 Google Doc di lavorazione (script, descrizione, titolo) per un progetto appena nato. */
export async function creaDocumentiLavorazione(
  taskId: string,
  poloNome: string,
  titoloProgetto: string,
  poloFolderId: string | null = null,
): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const admin = supabaseAdmin();

  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER;
  if (!root) return;

  try {
    const token = await tokenGoogle();
    const cartellaPolo = poloFolderId ?? await trovaOCreaCartella(token, root, poloNome);
    const cartellaLavorazione = await trovaOCreaCartella(token, cartellaPolo, "Documenti di lavorazione");

    const documenti: Array<[string, string]> = [
      ["script", "Script"],
      ["descrizione", "Descrizione"],
      ["titolo_youtube", "Titolo YouTube"],
    ];

    for (const [kind, suffisso] of documenti) {
      try {
        const { data: es } = await admin
          .from("deliverables")
          .select("id")
          .eq("task_id", taskId)
          .eq("kind", kind)
          .maybeSingle();
        if (es) continue; // già esiste

        const doc = await creaGoogleDocLavorazione(titoloProgetto, suffisso, cartellaLavorazione);
        await admin.from("deliverables").insert({
          task_id: taskId,
          kind,
          google_doc_url: doc.url,
          created_by: null,
        });
      } catch (e) {
        console.error(`creaDocumentiLavorazione ${kind}:`, e);
      }
    }
  } catch (e) {
    console.error("creaDocumentiLavorazione:", e);
  }
}

/**
 * Copia di sicurezza dell'accordo (o di un documento di rinnovo) firmato su
 * Google Drive, nella cartella "Gestione canale" del Drive del progetto
 * (fuori da "Archivio video"), divisa per polo: dentro la sottocartella del
 * polo dell'utente con nome "Nome Cognome.pdf". Il quarto parametro sceglie
 * la cartella: "accordi" (default, primo accordo) o "rinnovi" (documenti di
 * rinnovo Art. 9.1, accanto agli accordi). Best-effort: il documento resta
 * comunque nel gestionale (Supabase) — questa è solo una copia di riserva.
 * Le cartelle vengono trovate o create al volo.
 */
const GESTIONE_CANALE_FOLDER = "1Kwo27smMsRCKfUy1rgcBwHVZpcjsYTyY";

export async function archiviaAccordoSuDrive(
  buffer: Buffer,
  nomeFile: string,
  poliUtente: string[],
  sottoCartella: "accordi" | "rinnovi" = "accordi",
): Promise<{ ok: true } | { ok: false; errore: string }> {
  try {
    const token = await tokenGoogle();
    const cartellaAccordi = await trovaOCreaCartella(token, GESTIONE_CANALE_FOLDER, sottoCartella);
    // Un utente può appartenere a più gruppi: l'accordo va in ciascuno.
    const cartelle = poliUtente.length ? poliUtente : ["Senza gruppo"];

    for (const polo of cartelle) {
      const cartellaPolo = await trovaOCreaCartella(token, cartellaAccordi, polo);

      // Upload resumable (stesso pattern di esporta-drive): l'accordo è
      // piccolo, ma il percorso resta valido anche per file futuri più grandi.
      const inizio = await df(
        token,
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(buffer.byteLength),
            "X-Upload-Content-Type": "application/pdf",
          },
          body: JSON.stringify({
            name: nomeFile,
            mimeType: "application/pdf",
            parents: [cartellaPolo],
          }),
        },
      );
      if (!inizio.ok) return { ok: false, errore: `Avvio upload: HTTP ${inizio.status}` };
      const location = inizio.headers.get("location");
      if (!location) return { ok: false, errore: "Upload: nessuna sessione restituita" };

      const put = await fetch(location, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf", "Content-Length": String(buffer.byteLength) },
        body: new Uint8Array(buffer),
      });
      if (!put.ok) return { ok: false, errore: `Upload: HTTP ${put.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: e instanceof Error ? e.message : "Errore upload Drive" };
  }
}
