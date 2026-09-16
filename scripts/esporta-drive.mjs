#!/usr/bin/env node
/**
 * esporta-drive.mjs — porta su Google Drive i pacchetti sigillati in coda.
 *
 * Perché non lo fa la piattaforma: la service account Google usata dalle Edge
 * Function NON ha quota di archiviazione ("Service Accounts do not have storage
 * quota"), quindi non può creare file su Drive. Questo script usa rclone con
 * l account del progetto (le cui credenziali stanno in ~/.config/rclone), che
 * la quota ce l ha.
 *
 *   node scripts/esporta-drive.mjs --verifica    controlla rclone e le cartelle dei gruppi
 *   node scripts/esporta-drive.mjs               mostra cosa farebbe (nessuna scrittura)
 *   node scripts/esporta-drive.mjs --esegui      esegue davvero
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(".env.local", "utf8").split(String.fromCharCode(10))) {
  const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2]; if (v.charCodeAt(0) === 34 || v.charCodeAt(0) === 39) v = v.slice(1); if (v.charCodeAt(v.length - 1) === 34 || v.charCodeAt(v.length - 1) === 39) v = v.slice(0, -1); env[m[1]] = v; }
}

const ESEGUI = process.argv.includes("--esegui");
const VERIFICA = process.argv.includes("--verifica");
const RCLONE = process.env.RCLONE || (existsSync(join(homedir(), "bin", "rclone")) ? join(homedir(), "bin", "rclone") : "rclone");
const RADICE = "gdrive:TOOTHTALK/Archivio video";
const CARTELLA_PER_RUOLO = {
  video: "1 - Video",
  copertina: "2 - Copertine",
  liberatoria: "Liberatorie",
  dichiarazione_identita: "Dichiarazioni",
  dichiarazione_integrazione: "Dichiarazioni",
};
const SANITIZZA = /[/\\:*?"<>|]/g;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const rclone = (args) => execFileSync(RCLONE, args, { encoding: "utf8" });

/** Nome della cartella Drive di un gruppo (la service account la legge, in sola lettura). */
async function nomeCartellaPolo(poloId) {
  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const b64u = (x) => Buffer.from(x).toString("base64url");
  const ora = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const c = b64u(JSON.stringify({ iss: key.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: ora, exp: ora + 3600 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(h + "." + c), key.private_key).toString("base64url");
  const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: h + "." + c + "." + sig }) });
  const tok = await tr.json();
  if (!tok.access_token) throw new Error("token Google non ottenuto");
  const r = await fetch("https://www.googleapis.com/drive/v3/files/" + poloId + "?fields=name&supportsAllDrives=true", { headers: { Authorization: "Bearer " + tok.access_token } });
  const j = await r.json();
  if (!j.name) throw new Error("cartella del gruppo non leggibile");
  return j.name;
}

if (VERIFICA) {
  console.log("rclone:", rclone(["--version"]).split(String.fromCharCode(10))[0]);
  console.log("radice Drive:", rclone(["lsd", "gdrive:TOOTHTALK"]).trim().split(String.fromCharCode(10)).map((x) => x.trim()).join(" | "));
  const { data: poli } = await db.from("poli").select("nome, drive_folder_id").order("nome");
  console.log("Cartelle dei gruppi:");
  for (const p of poli ?? []) {
    let nome = "(non configurata)";
    if (p.drive_folder_id) {
      try { nome = await nomeCartellaPolo(p.drive_folder_id); } catch (e) { nome = "ERRORE: " + e.message; }
    }
    console.log("  ", p.nome.padEnd(18), "->", RADICE + "/" + nome);
  }
  process.exit(0);
}

const { data: coda, error } = await db.from("esportazioni_drive").select("pacchetto_id, stato, tentativi").in("stato", ["da_fare", "errore"]);
if (error) { console.error("Lettura della coda non riuscita:", error.message); process.exit(1); }
if (!coda.length) {
  console.log("Coda vuota: nessun pacchetto da esportare.");
  console.log("(I pacchetti entrano in coda quando si sigilla un video completo.)");
  process.exit(0);
}

console.log("Pacchetti in coda:", coda.length, ESEGUI ? "— esecuzione reale" : "— simulazione (aggiungi --esegui per eseguire)");

for (const riga of coda) {
  try {
    const { data: pk } = await db.from("pacchetti_video").select("id, task_id, manifest, manifest_hash").eq("id", riga.pacchetto_id).single();
    const { data: task } = await db.from("tasks").select("titolo, numero_video, polo_id").eq("id", pk.task_id).single();
    const { data: polo } = await db.from("poli").select("nome, drive_folder_id").eq("id", task.polo_id).single();
    const { data: elementi } = await db.from("pacchetto_elementi").select("ruolo, deliverable_versions!inner(bucket, storage_path, file_name)").eq("pacchetto_id", pk.id);

    const nomeCartella = polo.drive_folder_id ? await nomeCartellaPolo(polo.drive_folder_id) : polo.nome;
    const destinazionePolo = RADICE + "/" + nomeCartella + "/GESTIONE VIDEO";
    const num = task.numero_video ?? "?";
    const nomeBase = ("Video " + num + " — " + task.titolo).replace(SANITIZZA, "_");
    console.log(String.fromCharCode(10) + "Pacchetto " + polo.nome + " · " + nomeBase + " -> " + destinazionePolo);

    const temp = mkdtempSync(join(tmpdir(), "esporta-drive-"));
    let fatti = 0;
    for (const el of elementi ?? []) {
      const v = el.deliverable_versions;
      const sotto = CARTELLA_PER_RUOLO[el.ruolo];
      if (!sotto) continue;
      const ext = v.file_name.includes(".") ? v.file_name.slice(v.file_name.lastIndexOf(".")) : "";
      const nome = nomeBase + ext;
      console.log("   " + el.ruolo.padEnd(24) + " -> " + sotto + "/" + nome);
      if (!ESEGUI) continue;
      const { data: blob } = await db.storage.from(v.bucket).download(v.storage_path);
      if (!blob) throw new Error("file non scaricabile: " + v.bucket + "/" + v.storage_path);
      const locale = join(temp, nome);
      writeFileSync(locale, Buffer.from(await blob.arrayBuffer()));
      rclone(["copyto", locale, destinazionePolo + "/" + sotto + "/" + nome]);
      fatti++;
    }

    if (!ESEGUI) continue;
    if (pk.manifest) {
      const locale = join(temp, nomeBase + ".json");
      writeFileSync(locale, JSON.stringify({ manifest: pk.manifest, manifest_hash: pk.manifest_hash ?? null }, null, 2));
      rclone(["copyto", locale, destinazionePolo + "/Verbali/" + nomeBase + ".json"]);
    }
    await db.from("esportazioni_drive").update({ stato: "fatto", ultimo_errore: null }).eq("pacchetto_id", pk.id);
    console.log("   concluso: " + fatti + " file caricati");
  } catch (e) {
    console.error("   errore:", e.message);
    if (ESEGUI) await db.from("esportazioni_drive").update({ stato: "errore", ultimo_errore: String(e.message).slice(0, 500) }).eq("pacchetto_id", riga.pacchetto_id);
  }
}

console.log(String.fromCharCode(10) + (ESEGUI ? "Esportazione conclusa." : "Simulazione conclusa: nessuna scrittura."));
