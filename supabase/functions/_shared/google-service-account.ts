// ============================================================================
// Token Google via service account (nessuna identità umana coinvolta): il
// token non scade mai e non richiede consenso OAuth periodico. Le cartelle
// toccate devono essere condivise manualmente (una tantum) con l'email del
// service account. Condiviso da esporta-drive ed esporta-immagine-montaggio.
// ============================================================================

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const enc = new TextEncoder();

async function firmaJwt(clientEmail: string, privateKeyPem: string): Promise<string> {
  const ora = Math.floor(Date.now() / 1000);
  const header = base64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    enc.encode(
      JSON.stringify({
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/drive",
        aud: "https://oauth2.googleapis.com/token",
        iat: ora,
        exp: ora + 3600,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;

  const pem = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const chiave = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chiave, enc.encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(firma))}`;
}

let cache: { token: string; scadenza: number } | null = null;

/** Token OAuth con lo scope Drive, ottenuto tramite service account (JWT-bearer flow). */
export async function tokenGoogle(): Promise<string> {
  if (cache && cache.scadenza > Date.now()) return cache.token;

  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!raw) throw new Error("Credenziali service account Google assenti");
  const key = JSON.parse(raw) as { client_email: string; private_key: string };

  const jwt = await firmaJwt(key.client_email, key.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Token service account: HTTP ${res.status} ${await res.text()}`);
  const dati = await res.json();
  if (!dati.access_token) throw new Error("Token service account: risposta senza access_token");

  cache = { token: dati.access_token, scadenza: Date.now() + (dati.expires_in ?? 3600) * 1000 - 60_000 };
  return dati.access_token;
}
