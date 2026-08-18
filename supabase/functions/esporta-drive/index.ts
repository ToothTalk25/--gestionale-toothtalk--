// ============================================================================
// esporta-drive — copia i file di un pacchetto sigillato su Google Drive.
// ============================================================================
// Sostituisce l'esportazione che girava dentro la server action (Vercel):
// qui niente googleapis, solo fetch verso le REST API di Google e verso lo
// Storage Supabase (che è nello stesso data center).
//
// Viene chiamata dal trigger del database (pg_net) con Authorization: Bearer
// <chiave condivisa> appena la riga esportazioni_drive passa a 'da_fare'.
//
// Segreti (Edge Function secrets, non nel codice):
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → auto-iniettati da Supabase
//   - EDGE_FUNCTION_DRIVE_KEY                  → la stessa chiave del vault
//   - GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//     GOOGLE_OAUTH_REFRESH_TOKEN               → OAuth del Gmail ToothTalk
//   - GOOGLE_DRIVE_ROOT_FOLDER                 → id della cartella condivisa

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ------------------------------------------------------------------ utils

/** Token Google via OAuth refresh token: i file contano sulla quota del Gmail vero di ToothTalk. */
async function tokenGoogle(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Credenziali OAuth Google assenti");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token Google: HTTP ${res.status} ${await res.text()}`);
  }
  const dati = await res.json();
  if (!dati.access_token) {
    throw new Error("Token Google: risposta senza access_token");
  }
  return dati.access_token;
}


// ---------------------------------------------------------------- Drive API

const SANITIZZA = /[/\\:*?"<>|]/g;

async function driveFetch(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

/** Trova o crea la cartella <nome> dentro <parent> (o in root se parent è null). */
async function trovaOCreaCartella(
  token: string,
  parent: string | null,
  nome: string,
): Promise<string> {
  const nomePulito = nome.replace(SANITIZZA, "_");
  const parentQ = parent ? `'${parent}' in parents and ` : "";
  const q =
    `${parentQ}name='${nomePulito.replace(/'/g, "\\'")}' and ` +
    "mimeType='application/vnd.google-apps.folder' and trashed=false";

  const ricerca = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
  );
  if (!ricerca.ok) throw new Error(`Ricerca cartella: HTTP ${ricerca.status}`);
  const trovata = await ricerca.json();
  if (trovata.files?.length) return trovata.files[0].id;

  const crea = await driveFetch(token, "https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: nomePulito,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
    }),
  });
  const data = await crea.json();
  if (!crea.ok) throw new Error(`Crea cartella: HTTP ${crea.status} ${JSON.stringify(data)}`);
  return data.id;
}

/** Verifica se un file con un certo nome esiste già in una cartella Drive. */
async function esisteFile(token: string, cartella: string, nome: string): Promise<boolean> {
  const nomePulito = nome.replace(SANITIZZA, "_");
  const q = `'${cartella}' in parents and name='${nomePulito.replace(/'/g, "\\'")}' and trashed=false`;
  const r = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (!r.ok) return false;
  const j = (await r.json()) as { files?: { id: string }[] };
  return !!j.files?.length;
}

/** Trova un file per nome dentro una cartella (o null). */
async function trovaFile(token: string, cartella: string, nome: string, mimeType: string): Promise<string | null> {
  const q = `'${cartella}' in parents and name='${nome.replace(/'/g, "\\'")}' and mimeType='${mimeType}' and trashed=false`;
  const r = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (!r.ok) return null;
  const j = (await r.json()) as { files?: { id: string }[] };
  return j.files?.length ? j.files[0].id : null;
}

/** Scarica il contenuto testuale di un file (drive export per i Google Doc). */
async function leggiTestoFile(token: string, fileId: string, mimeType: string): Promise<string> {
  const url =
    mimeType === "application/vnd.google-apps.document"
      ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
      : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const dl = await driveFetch(token, url);
  if (!dl.ok) return "";
  return await dl.text();
}

/**
 * Accoda testo in fondo a un Google Doc nativo con la Docs API.
 * L'intestazione ("Video N - Titolo - Data") viene scritta come paragrafo di
 * stile HEADING_2: così compare nell'indice a sinistra del documento, ed è
 * possibile saltare direttamente alla sezione del video da pubblicare.
 * Se il testo contiene già l'intestazione, non fa nulla (idempotente).
 */
async function appendiAlGoogleDoc(token: string, docId: string, intestazione: string, contenuto: string): Promise<void> {
  const esistente = await leggiTestoFile(token, docId, "application/vnd.google-apps.document");
  if (esistente.includes(intestazione)) return; // già accodato

  const get = await driveFetch(token, `https://docs.googleapis.com/v1/documents/${docId}`);
  if (!get.ok) throw new Error(`Leggi Google Doc ${docId}: HTTP ${get.status}`);
  const doc = (await get.json()) as { body?: { content?: { endIndex?: number }[] } };
  const content = doc.body?.content ?? [];
  const endIndex = content.length ? (content[content.length - 1].endIndex ?? 1) : 1;
  const inizio = Math.max(endIndex - 1, 0);

  const rigaIntestazione = `${intestazione}\n`;
  const testo = `${rigaIntestazione}${contenuto}\n`;

  const res = await driveFetch(token, `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { insertText: { location: { index: inizio }, text: testo } },
        {
          updateParagraphStyle: {
            range: { startIndex: inizio, endIndex: inizio + rigaIntestazione.length },
            paragraphStyle: { namedStyleType: "HEADING_2" },
            fields: "namedStyleType",
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Append Google Doc ${docId}: HTTP ${res.status} ${await res.text()}`);
}

/**
 * Upload resumable su Drive: POST iniziale (uploadType=resumable) per
 * ottenere l'URI di sessione dall'header Location, poi PUT del contenuto.
 * `body` può essere uno stream (ReadableStream): per i file grossi il
 * contenuto non viene mai bufferizzato in memoria.
 */
async function caricaResumable(
  token: string,
  cartella: string,
  nome: string,
  mimeType: string,
  sizeBytes: number,
  body: BodyInit,
): Promise<void> {
  const inizio = await driveFetch(
    token,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Upload-Content-Length": String(sizeBytes),
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify({ name: nome, mimeType, parents: [cartella] }),
    },
  );
  if (!inizio.ok) {
    throw new Error(`Avvio upload: HTTP ${inizio.status} ${await inizio.text()}`);
  }

  const location = inizio.headers.get("location");
  if (!location) throw new Error("Upload: nessuna sessione restituita");

  const put = await fetch(location, {
    method: "PUT",
    headers: {
      "Content-Length": String(sizeBytes),
      "Content-Type": mimeType,
    },
    body,
  });
  if (!put.ok) throw new Error(`Upload: HTTP ${put.status} ${await put.text()}`);
}

// ------------------------------------------------------------------ handler

Deno.serve(async (req) => {
  // Solo la chiamata dal trigger del database è autorizzata: la chiave
  // condivisa vive sia in vault sia nei secret della Edge Function.
  const chiave = Deno.env.get("EDGE_FUNCTION_DRIVE_KEY");
  if (!chiave || req.headers.get("authorization") !== `Bearer ${chiave}`) {
    return new Response(JSON.stringify({ errore: "Non autorizzato" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let pacchettoId: string;
  try {
    const body = await req.json();
    pacchettoId = String(body.pacchetto_id ?? "");
  } catch {
    return new Response(JSON.stringify({ errore: "Corpo JSON assente" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!pacchettoId) {
    return new Response(JSON.stringify({ errore: "pacchetto_id mancante" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ errore: "Supabase non configurata" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let tentativi = 0;

  try {
    const { data: riga } = await supabase
      .from("esportazioni_drive")
      .select("tentativi")
      .eq("pacchetto_id", pacchettoId)
      .maybeSingle();
    tentativi = riga?.tentativi ?? 0;

    await supabase
      .from("esportazioni_drive")
      .update({ stato: "in_corso" })
      .eq("pacchetto_id", pacchettoId);

    // --- dati del pacchetto, del progetto e del gruppo
    const { data: pacchetto, error: eP } = await supabase
      .from("pacchetti_video")
      .select("task_id, descrizione, script, titolo_youtube, manifest, manifest_hash")
      .eq("id", pacchettoId)
      .single();
    if (eP || !pacchetto) throw new Error("Pacchetto non trovato");

    const { data: task, error: eT } = await supabase
      .from("tasks")
      .select("titolo, polo_id, numero_video")
      .eq("id", pacchetto.task_id)
      .single();
    if (eT || !task) throw new Error("Progetto non trovato");

    const { data: polo, error: eL } = await supabase
      .from("poli")
      .select("nome, drive_folder_id")
      .eq("id", task.polo_id)
      .single();
    if (eL || !polo) throw new Error("Gruppo non trovato");

    const { data: elementi } = await supabase
      .from("pacchetto_elementi")
      .select(
        "ruolo, deliverable_versions!inner(bucket, storage_path, file_name, mime_type, size_bytes)",
      )
      .eq("pacchetto_id", pacchettoId);

    // --- cartella del polo: usa drive_folder_id se configurato
    const token = await tokenGoogle();
    const root = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER");
    if (!root) throw new Error("Secret GOOGLE_DRIVE_ROOT_FOLDER assente");
    const cartellaPolo = polo.drive_folder_id
      ? polo.drive_folder_id
      : await trovaOCreaCartella(token, root, polo.nome);

    const num = task.numero_video ?? "?";
    // Trattino lungo, come i file già presenti nelle cartelle su Drive:
    // "Video 1 — Titolo". Coerente con i nomi sistemati a mano.
    const nomeBase = `Video ${num} — ${task.titolo}`.replace(SANITIZZA, "_");

    // Struttura di destinazione: tutto dentro GESTIONE VIDEO
    const cartellaGV = await trovaOCreaCartella(token, cartellaPolo, "GESTIONE VIDEO");
    const cartVideo = await trovaOCreaCartella(token, cartellaGV, "1 - Video");
    const cartCopertine = await trovaOCreaCartella(token, cartellaGV, "2 - Copertine");
    const cartLiberatorie = await trovaOCreaCartella(token, cartellaGV, "Liberatorie");
    const cartVerbali = await trovaOCreaCartella(token, cartellaGV, "Verbali");

    // --- testi accumulati: append nei Google Docs di GESTIONE VIDEO
    const encoder = new TextEncoder();
    const manifestSigillo = pacchetto.manifest as { sigillato_at?: string } | null;
    const dataSigillo = new Date(manifestSigillo?.sigillato_at ?? Date.now()).toLocaleDateString("it-IT");
    // Intestazione scritta come HEADING_2 nel Google Doc: compare nell'indice
    // a sinistra, per saltare subito alla sezione del video da pubblicare.
    const intestazione = `Video ${num} - ${task.titolo} - ${dataSigillo}`;

    // Trova le cartelle e i Google Docs
    const cartScript = await trovaOCreaCartella(token, cartellaGV, "3 - Script");
    const cartDescr = await trovaOCreaCartella(token, cartellaGV, "4 - Descrizioni");
    const cartTitoli = await trovaOCreaCartella(token, cartellaGV, "5 - Titoli YouTube");

    const docScript = await trovaFile(token, cartScript, "SCRIPT VIDEO", "application/vnd.google-apps.document");
    const docDescr = await trovaFile(token, cartDescr, "DESCRIZIONI VIDEO", "application/vnd.google-apps.document");
    const docTitoli = await trovaFile(token, cartTitoli, "TITOLI YOUTUBE SHORTS", "application/vnd.google-apps.document");

    const testiDaAccumulare: Array<{ docId: string | null; nomeFile: string; contenuto: string | null }> = [
      { docId: docDescr, nomeFile: "DESCRIZIONI VIDEO", contenuto: pacchetto.descrizione },
      { docId: docTitoli, nomeFile: "TITOLI YOUTUBE SHORTS", contenuto: pacchetto.titolo_youtube },
      { docId: docScript, nomeFile: "SCRIPT VIDEO", contenuto: pacchetto.script },
    ];

    for (const t of testiDaAccumulare) {
      if (!t.contenuto) continue;
      if (!t.docId) {
        console.log(`Google Doc ${t.nomeFile} non trovato in GESTIONE VIDEO: salto`);
        continue;
      }
      await appendiAlGoogleDoc(token, t.docId, intestazione, t.contenuto);
    }

    // --- file binari: rinominate #N - Titolo.estensione

    const CARTELLA_PER_RUOLO: Record<string, string> = {
      video: cartVideo,
      copertina: cartCopertine,
      liberatoria: cartLiberatorie,
    };
    for (const el of elementi ?? []) {
      const v = el.deliverable_versions as {
        bucket: string;
        storage_path: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
      };
      const size = Number(v.size_bytes ?? 0);
      if (!size) throw new Error(`File senza dimensione: ${v.file_name}`);

      const ext = v.file_name.includes(".") ? v.file_name.slice(v.file_name.lastIndexOf(".")) : "";
      const nomeFinale = nomeBase + ext;

      const dest = CARTELLA_PER_RUOLO[el.ruolo as string];
      if (!dest) continue;

      // Idempotenza: se il file esiste già, è stato caricato in un tentativo precedente
      if (await esisteFile(token, dest, nomeFinale)) continue;

      const path = v.storage_path.split("/").map(encodeURIComponent).join("/");
      const scarica = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(v.bucket)}/${path}`,
        // Con le chiavi nel nuovo formato (sb_secret_...) lo Storage REST
        // richiede sia Authorization sia apikey: senza apikey risponde 400
        // "Bucket not found", un errore fuorviante che non è di permessi.
        { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
      );
      if (!scarica.ok) {
        throw new Error(`Storage ${v.bucket}/${v.storage_path}: HTTP ${scarica.status}`);
      }
      if (!scarica.body) {
        throw new Error(`Storage ${v.bucket}/${v.storage_path}: risposta senza contenuto`);
      }

      await caricaResumable(token, dest, nomeFinale, v.mime_type ?? "application/octet-stream", size, scarica.body);
    }

    // --- verbale (manifesto del sigillo) nella cartella Verbali
    if (pacchetto.manifest) {
      const nomeVerbale = nomeBase + ".json";
      if (!(await esisteFile(token, cartVerbali, nomeVerbale))) {
        const verbale = JSON.stringify(
          { manifest: pacchetto.manifest, manifest_hash: pacchetto.manifest_hash ?? null },
          null,
          2,
        );
        const buf = encoder.encode(verbale);
        await caricaResumable(token, cartVerbali, nomeVerbale, "application/json", buf.byteLength, buf);
      }
    }

    // --- successo
    await supabase
      .from("esportazioni_drive")
      .update({
        stato: "fatto",
        cartella_drive_id: cartellaPolo,
        cartella_drive_url: `https://drive.google.com/drive/folders/${cartellaPolo}`,
        ultimo_errore: null,
      })
      .eq("pacchetto_id", pacchettoId);

    return new Response(JSON.stringify({ ok: true, cartella: cartellaPolo }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // Mai lasciare la riga bloccata su 'in_corso'.
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    await supabase
      .from("esportazioni_drive")
      .update({
        stato: "errore",
        ultimo_errore: msg.slice(0, 500),
        tentativi: tentativi + 1,
      })
      .eq("pacchetto_id", pacchettoId);

    return new Response(JSON.stringify({ errore: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

