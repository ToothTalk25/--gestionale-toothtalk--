/**
 * Prova del percorso VERO verso i progetti per chi non ha completato l'accordo:
 * dal profilo, menu dell'avatar -> voce "Progetti" (o "Risorse").
 *
 * Quelle voci sono dentro una tendina chiusa — per questo non comparivano
 * nell'elenco dei link della pagina — e sono visibili a chiunque: era la via
 * d'ingresso usata per arrivare nei progetti senza aver caricato l'accordo
 * (con il blocco nel solo layout, una navigazione con i clic non lo riesegue).
 * Adesso il blocco sta nel middleware e ogni clic passa di lì.
 *
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_e2e_menu_progetti.mjs
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

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = "prova.senza.accordo@toothtalk.local";
const PASSWORD = "ProvaSenzaAccordo2026!";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: polo } = await db.from("poli").select("id").eq("slug", "prova").single();
// Ripetibile: toglie l'eventuale residuo di un tentativo interrotto.
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);

const { data: creato, error } = await db.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Prova Senza Accordo" },
});
if (error) {
  console.error("creazione fallita:", error.message);
  process.exit(1);
}
await db.from("memberships").insert({ user_id: creato.user.id, polo_id: polo.id });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: "Accedi" }).click();
// Come nell'altra prova: attesa sull'URL, non su un tempo fisso (il primo
// server action in locale può essere lento e falsare il risultato).
await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60000 });
await page.waitForTimeout(3000);
console.log("atterra su:", page.url().replace(BASE, ""));

for (const voce of ["Progetti", "Risorse", "Profilo"]) {
  await page.goto(`${BASE}/profilo`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // apre la tendina del menu utente: l'avatar è in alto a destra
  await page.locator("header button").last().click();
  await page.waitForTimeout(1200);
  const tendina = (await page.locator('[role="menu"]').count()) > 0;
  const presente = await page.getByRole("menuitem", { name: voce, exact: true }).count();
  if (!presente) {
    console.log(`  voce "${voce}": tendina aperta=${tendina}, voce presente=${presente} ✗`);
    continue;
  }
  await page.getByRole("menuitem", { name: voce, exact: true }).first().click();
  await page.waitForTimeout(3000);
  const dove = page.url().replace(BASE, "");
  const bloccato = dove.includes("/profilo");
  console.log(`  tendina=${tendina ? "sì" : "no"} · clic su "${voce.padEnd(9)}" -> ${dove} | ${bloccato ? "bloccato ✓" : "DENTRO ✗✗"}`);
}

await browser.close();
await db.auth.admin.deleteUser(creato.user.id);
console.log("account di prova cancellato");
