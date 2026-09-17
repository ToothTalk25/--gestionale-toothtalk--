/**
 * Verifica che la guida in Risorse si apra davvero per chi ha firmato:
 * crea un collaboratore di prova con accordo completo, entra col browser,
 * apre Risorse, clicca la guida e confronta i byte con il file nel repo.
 * Alla fine cancella l'account.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "https://gestionale-toothtalk.vercel.app";
const FILE = "guida-facoltativa-video-presentazione-team.pdf";
const TITOLO = "Guida facoltativa per video di presentazione team";
const EMAIL = "prova.guida@toothtalk.local";
const PASSWORD = "ProvaGuidaRisorse2026!";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const locale = readFileSync(`public/risorse/${FILE}`);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: polo } = await db.from("poli").select("id").eq("slug", "prova").single();
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);

const { data: creato, error } = await db.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Prova Guida" },
});
if (error) {
  console.error("creazione fallita:", error.message);
  process.exit(1);
}
await db.from("memberships").insert({ user_id: creato.user.id, polo_id: polo.id });
await db.from("profiles").update({
  accordo_path: "prova/accordo/finto.pdf",
  accordo_letto_confermato: true,
  accordo_verificato: "ok",
  accordo_approvato_admin_at: "2026-09-01T10:00:00+02:00",
  accordo_scadenza: "2027-03-01",
}).eq("id", creato.user.id);
console.log("collaboratore di prova creato (accordo completo, franchigia)");

await new Promise((r) => setTimeout(r, 6000));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: "Accedi" }).click();
let ok = false;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(2000);
  if (!new URL(page.url()).pathname.startsWith("/login")) {
    ok = true;
    break;
  }
}
console.log("accesso:", ok ? `SÌ ✓ (${page.url().replace(BASE, "")})` : "NO ✗");
if (ok) {
  await page.goto(`${BASE}/risorse`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const testo = await page.innerText("body");
  console.log("scheda «Guida facoltativa per video di presentazione team»:", testo.includes(TITOLO) ? "SÌ ✓" : "NO ✗");
  console.log("schede visibili:", (testo.match(/Piano editoriale|Calendario editoriale|Guida facoltativa[^\n]*/g) ?? []).join(" · "));

  // Il clic porta il browser *dentro* il PDF, quindi il corpo non è più
  // leggibile: si chiede lo stesso file con la sessione del browser (stessi
  // cookie) e si confrontano i byte con il file nel repo.
  const risposta = await page.context().request.get(`${BASE}/risorse/${FILE}`);
  const corpo = Buffer.from(await risposta.body());
  console.log(
    `guida scaricata -> ${risposta.status()} · ${risposta.headers()["content-type"]} · ${corpo.byteLength} byte` +
      ` · identica al file nel repo: ${hash(corpo) === hash(locale) ? "SÌ ✓" : "NO ✗"}`,
  );
  console.log(`inizia con %PDF: ${corpo.subarray(0, 4).toString() === "%PDF" ? "sì ✓" : "NO ✗"}`);
}
await browser.close();
await db.auth.admin.deleteUser(creato.user.id);
console.log("account di prova cancellato");
