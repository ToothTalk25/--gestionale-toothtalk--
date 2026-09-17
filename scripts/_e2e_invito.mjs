/**
 * Prova del link d'invito: /registrati?codice=XXXX deve arrivare col codice
 * già compilato e mostrare il nome del gruppo (quello che deve vedere chi
 * schiaccia il pulsante nell'email).
 *
 *   node scripts/_e2e_invito.mjs                       (in locale, con npm run dev)
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_e2e_invito.mjs
 *
 * Il codice lo legge dal database (il codice vivo del gruppo), non è scritto qui.
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
const SLUG = process.env.SLUG ?? "spagna";

let fallimenti = 0;
function verifica(titolo, cond, extra = "") {
  if (!cond) fallimenti++;
  console.log(`${cond ? "OK  " : "KO  "} ${titolo}${extra ? ` — ${extra}` : ""}`);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: polo } = await db.from("poli").select("id, nome").eq("slug", SLUG).single();
if (!polo) {
  console.error("Gruppo non trovato:", SLUG);
  process.exit(1);
}
const { data: invito } = await db
  .from("inviti")
  .select("codice")
  .eq("polo_id", polo.id)
  .eq("attivo", true)
  .limit(1)
  .maybeSingle();
if (!invito) {
  console.error("Il gruppo non ha un codice vivo:", polo.nome);
  process.exit(1);
}
console.log(`Gruppo: ${polo.nome} · codice vivo: ${invito.codice} · sito: ${BASE}`);

const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(`${BASE}/registrati?codice=${invito.codice}`, { waitUntil: "domcontentloaded" });

  const compilato = await page.waitForFunction(
    (atteso) => [...document.querySelectorAll("input")].some((i) => i.value === atteso),
    invito.codice,
    { timeout: 20000 },
  ).then(() => true, () => false);
  verifica("il campo del codice arriva già compilato dal link", compilato);

  const gruppoVisibile = await page
    .getByText(polo.nome, { exact: false })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true, () => false);
  verifica(`il gruppo «${polo.nome}» compare nella pagina`, gruppoVisibile);
} catch (e) {
  verifica("la pagina /registrati si apre", false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

console.log(fallimenti === 0 ? "\nTutti i controlli superati." : `\n${fallimenti} controlli falliti.`);
process.exit(fallimenti === 0 ? 0 : 1);
