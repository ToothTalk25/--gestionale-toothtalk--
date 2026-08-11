// ============================================================================
// esporta-immagine-montaggio — copia su Drive le immagini caricate come
//                                "Immagini montaggio video".
// ============================================================================
// Chiamata dal trigger del database (pg_net) dopo ogni upload di un file
// nella deliverable "immagini_montaggio", se il polo ha una cartella Drive
// configurata (poli.drive_immagini_montaggio_folder_id).
//
// Segreti (Edge Function secrets, non nel codice):
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  → auto-iniettati da Supabase
//   - EDGE_FUNCTION_IMMAGINI_KEY               → la stessa chiave del vault
//   - GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//     GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER

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
  const chiave = Deno.env.get("EDGE_FUNCTION_IMMAGINI_KEY");
  if (!chiave || req.headers.get("authorization") !== `Bearer ${chiave}`) {
    return new Response(JSON.stringify({ errore: "Non autorizzato" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let versionId: string;
  let numeroVideo: number;
  let titolo: string;
  let cartellaDriveId: string;
  try {
    const body = await req.json();
    versionId = String(body.version_id ?? "");
    numeroVideo = Number(body.numero_video ?? 0);
    titolo = String(body.titolo ?? "").trim();
    cartellaDriveId = String(body.cartella_drive_id ?? "");
  } catch {
    return new Response(JSON.stringify({ errore: "Corpo JSON assente" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!versionId || !cartellaDriveId) {
    return new Response(JSON.stringify({ errore: "version_id o cartella_drive_id mancante" }), {
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

  try {
    const { data: versione, error: e } = await supabase
      .from("deliverable_versions")
      .select("bucket, storage_path, file_name, mime_type, size_bytes")
      .eq("id", versionId)
      .single();
    if (e || !versione) throw new Error("Versione non trovata: " + (e?.message ?? "inesistente"));

    const size = Number(versione.size_bytes ?? 0);
    if (!size) throw new Error(`File senza dimensione: ${versione.file_name}`);

    const nomeCartella = `Video ${numeroVideo} — ${titolo}`.replace(SANITIZZA, "_");
    const token = await tokenGoogle();
    const cartella = await trovaOCreaCartella(token, cartellaDriveId, nomeCartella);

    const path = versione.storage_path.split("/").map(encodeURIComponent).join("/");
    const scarica = await fetch(
      `${supabaseUrl}/storage/v1/object/${encodeURIComponent(versione.bucket)}/${path}`,
      { headers: { Authorization: `Bearer ${serviceKey}` } },
    );
    if (!scarica.ok) {
      throw new Error(`Storage ${versione.bucket}/${versione.storage_path}: HTTP ${scarica.status}`);
    }
    if (!scarica.body) {
      throw new Error(`Storage ${versione.bucket}/${versione.storage_path}: risposta senza contenuto`);
    }

    await caricaResumable(
      token,
      cartella,
      versione.file_name,
      versione.mime_type ?? "application/octet-stream",
      size,
      scarica.body,
    );

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore sconosciuto";
    console.error("esporta-immagine-montaggio:", msg);
    return new Response(JSON.stringify({ errore: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

