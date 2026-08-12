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
