/**
 * Verifica dell'ordine dei gruppi nella barra in alto: serve un account
 * membro di TUTTI i gruppi (la barra mostra solo i propri), quindi lo crea,
 * legge l'ordine, e lo cancella.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "https://gestionale-toothtalk.vercel.app";
const EMAIL = "prova.barra@toothtalk.local";
const PASSWORD = "ProvaBarraGruppi2026!";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: poli } = await db.from("poli").select("id, nome, attivo").eq("attivo", true).order("nome");
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);

const { data: creato, error } = await db.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Prova Barra" },
});
if (error) {
  console.error("creazione fallita:", error.message);
  process.exit(1);
}
for (const p of poli ?? []) {
  await db.from("memberships").insert({ user_id: creato.user.id, polo_id: p.id });
}
await db.from("profiles").update({
  accordo_path: "prova/accordo/finto.pdf",
  accordo_letto_confermato: true,
  accordo_verificato: "ok",
  accordo_approvato_admin_at: "2026-09-01T10:00:00+02:00",
  accordo_scadenza: "2027-03-01",
}).eq("id", creato.user.id);
console.log(`account di prova creato, membro di ${poli?.length ?? 0} gruppi`);

await new Promise((r) => setTimeout(r, 6000));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: "Accedi" }).click();
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(2000);
  if (!new URL(page.url()).pathname.startsWith("/login")) break;
}

const perId = new Map((poli ?? []).map((p) => [p.id, p.nome]));
const href = await page.$$eval('header nav a[href^="/polo/"]', (as) =>
  as.map((a) => a.getAttribute("href") ?? ""),
);
const ordine = href.map((h) => perId.get(h.replace("/polo/", "")) ?? h);
console.log("ordine nella barra in alto:", ordine.join(" · "));

const indiceUcam = ordine.indexOf("UCAM Universidad");
const indiceProva = ordine.indexOf("PROVA");
console.log(
  indiceProva >= 0 && indiceUcam >= 0 && indiceProva > indiceUcam
    ? "PROVA è a destra di UCAM Universidad ✓"
    : `ordine non corretto ✗ (UCAM alla posizione ${indiceUcam}, PROVA alla ${indiceProva})`,
);
console.log("Genova per prima:", ordine[0] === "Genova" ? "sì ✓" : `no ✗ (${ordine[0]})`);

await browser.close();
await db.auth.admin.deleteUser(creato.user.id);
console.log("account di prova cancellato");
