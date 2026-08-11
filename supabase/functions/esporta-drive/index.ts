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
      .select("task_id, descrizione, script, titolo_youtube")
      .eq("id", pacchettoId)
      .single();
    if (eP || !pacchetto) throw new Error("Pacchetto non trovato");

    const { data: task, error: eT } = await supabase
      .from("tasks")
      .select("titolo, polo_id")
      .eq("id", pacchetto.task_id)
      .single();
    if (eT || !task) throw new Error("Progetto non trovato");

    const { data: polo, error: eL } = await supabase
      .from("poli")
      .select("nome")
      .eq("id", task.polo_id)
      .single();
    if (eL || !polo) throw new Error("Gruppo non trovato");

    const { data: elementi } = await supabase
      .from("pacchetto_elementi")
      .select(
        "ruolo, deliverable_versions!inner(bucket, storage_path, file_name, mime_type, size_bytes)",
      )
      .eq("pacchetto_id", pacchettoId);

    // --- token Google e cartelle <root>/<Gruppo>/<Progetto>/
    const token = await tokenGoogle();
    const root = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER");
    if (!root) throw new Error("Secret GOOGLE_DRIVE_ROOT_FOLDER assente");
    const cartellaGruppo = await trovaOCreaCartella(token, root, polo.nome);
    const cartellaProgetto = await trovaOCreaCartella(token, cartellaGruppo, task.titolo);

    // --- testi (piccoli, vanno in memoria)
    const encoder = new TextEncoder();
    const testi: Array<{ nome: string; testo: string }> = [];
    if (pacchetto.descrizione) testi.push({ nome: "descrizione.txt", testo: pacchetto.descrizione });
    if (pacchetto.script) testi.push({ nome: "script.txt", testo: pacchetto.script });
    if (pacchetto.titolo_youtube) testi.push({ nome: "titolo_youtube.txt", testo: pacchetto.titolo_youtube });

    for (const t of testi) {
      const buf = encoder.encode(t.testo);
      await caricaResumable(
        token,
        cartellaProgetto,
        t.nome,
        "text/plain; charset=utf-8",
        buf.byteLength,
        buf,
      );
    }

    // --- file: stream dallo Storage direttamente su Drive
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

      const path = v.storage_path.split("/").map(encodeURIComponent).join("/");
      const scarica = await fetch(
        `${supabaseUrl}/storage/v1/object/${encodeURIComponent(v.bucket)}/${path}`,
        { headers: { Authorization: `Bearer ${serviceKey}` } },
      );
      if (!scarica.ok) {
        throw new Error(`Storage ${v.bucket}/${v.storage_path}: HTTP ${scarica.status}`);
      }
      if (!scarica.body) {
        throw new Error(`Storage ${v.bucket}/${v.storage_path}: risposta senza contenuto`);
      }

      await caricaResumable(
        token,
        cartellaProgetto,
        v.file_name,
        v.mime_type ?? "application/octet-stream",
        size,
        scarica.body,
      );
    }

    // --- successo
    await supabase
      .from("esportazioni_drive")
      .update({
        stato: "fatto",
        cartella_drive_id: cartellaProgetto,
        cartella_drive_url: `https://drive.google.com/drive/folders/${cartellaProgetto}`,
        ultimo_errore: null,
      })
      .eq("pacchetto_id", pacchettoId);

    return new Response(JSON.stringify({ ok: true, cartella: cartellaProgetto }), {
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

