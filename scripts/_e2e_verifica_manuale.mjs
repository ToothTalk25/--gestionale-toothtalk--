/**
 * Prova reale della "verifica a mano" dell'accordo, in produzione.
 *
 * È la via d'uscita quando il controllo automatico non è disponibile: visto
 * davvero, il modello risponde 503 "high demand" e, con due PDF al seguito,
 * il 504 di tempo scaduto. Qui l'accesso globale controlla il documento di
 * persona e il motivo resta nel registro.
 *
 * Il partecipante di prova punta all'accordo di una persona vera (stesso file:
 * nessun documento inventato e nessun dato finto), quindi alla fine si
 * cancellano sia lui sia l'accesso di prova usato per entrare.
 *
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_e2e_verifica_manuale.mjs
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
const RIFERIMENTO = process.env.ACCORDO_EMAIL ?? "eugenia.papetti25@gmail.com";
const EMAIL_PARTECIPANTE = "prova.verifica.manuale@toothtalk.local";
const EMAIL_ADMIN = "prova.verifica.admin@toothtalk.local";
const PASSWORD = "ProvaVerificaMano2026!";
const MOTIVO = "Prova end-to-end: confrontato clausola per clausola col modello, firma presente.";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: riferimento } = await db
  .from("profiles")
  .select("accordo_path")
  .eq("email", RIFERIMENTO)
  .single();
if (!riferimento?.accordo_path) {
  console.error(`Serve un accordo caricato da ${RIFERIMENTO} per puntarci la riga di prova.`);
  process.exit(1);
}

const creaUtente = async (email, nome) => {
  const { data: residuo } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (residuo) await db.auth.admin.deleteUser(residuo.id);
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: nome },
  });
  if (error) throw new Error(`creazione ${email}: ${error.message}`);
  return data.user.id;
};

const idPartecipante = await creaUtente(EMAIL_PARTECIPANTE, "Prova Verifica a Mano");
const idAdmin = await creaUtente(EMAIL_ADMIN, "Prova Accesso Globale");

// La riga di prova è un accordo VERO già nel gestionale, ma con esito
// automatico non positivo: esattamente la situazione che si vuole sbloccare.
await db
  .from("profiles")
  .update({
    attivo: true,
    approvato_at: new Date().toISOString(),
    on_screen: false,
    accordo_path: riferimento.accordo_path,
    accordo_letto_confermato: true,
    accordo_verificato: "non_valutato",
    accordo_verifica_note: "prova end-to-end",
    accordo_verificato_at: new Date().toISOString(),
  })
  .eq("id", idPartecipante);
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idAdmin);

const browser = await chromium.launch();
const contesto = await browser.newContext();
const page = await contesto.newPage();
page.on("pageerror", (e) => console.log("  [errore pagina]", e.message.slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [console]", m.text().slice(0, 300));
});
let uscita = 0;

try {
  // Gli utenti creati via Admin API non sono autenticabili nello stesso
  // istante: senza questa attesa il login fallisce e la prova direbbe una
  // cosa falsa.
  await new Promise((r) => setTimeout(r, 6000));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(EMAIL_ADMIN);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  const fine = Date.now() + 60000;
  while (Date.now() < fine && new URL(page.url()).pathname.startsWith("/login")) {
    await page.waitForTimeout(500);
  }
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("login non riuscito");
  console.log(`login riuscito (${page.url().replace(BASE, "")})`);

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  // In /admin si vede UNA sola sezione, scelta dalla tendina "Vai a:".
  await page.selectOption("#sezione-admin", "accordi-da-approvare");
  await page.waitForTimeout(4000);

  const blocco = page.locator("div.border-amber-200").first();
  if ((await blocco.count()) === 0) throw new Error('blocco "Verifica IA non riuscita" non trovato');
  const riga = blocco
    .getByText(EMAIL_PARTECIPANTE)
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-slate-200')][1]");
  if ((await riga.count()) === 0) throw new Error("riga del partecipante di prova non trovata");
  console.log(`riga di prova a schermo:\n${(await riga.innerText()).replace(/^/gm, "    | ")}`);

  await riga.getByRole("button", { name: "Verifica tu, a mano" }).click();
  await riga.locator("textarea").fill(MOTIVO);
  await riga.getByRole("button", { name: "Registra la mia verifica" }).click();

  const scadenza = Date.now() + 60000;
  let dopo = null;
  while (Date.now() < scadenza) {
    const { data } = await db
      .from("profiles")
      .select("accordo_verificato, accordo_verifica_note, accordo_verificato_at")
      .eq("id", idPartecipante)
      .single();
    dopo = data;
    if (dopo?.accordo_verificato === "ok") break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1500);
  const aSchermo = await page
    .getByText(/Verifica a mano registrata:|^Errore: /)
    .first()
    .innerText()
    .catch(() => "(messaggio non letto a schermo)");

  console.log(`\nDopo: esito "${dopo?.accordo_verificato}" — ${dopo?.accordo_verifica_note}`);
  console.log(`A schermo: ${aSchermo.replace(/\s+/g, " ").trim()}`);

  const { data: registro } = await db
    .from("audit_log")
    .select("at, action, meta")
    .eq("action", "verifica_manuale_accordo")
    .eq("entity_id", idPartecipante)
    .order("at", { ascending: false })
    .limit(1);
  console.log(`Riga di registro: ${JSON.stringify(registro?.[0] ?? null)}`);

  if (dopo?.accordo_verificato !== "ok" || !registro?.length) {
    uscita = 1;
    console.log("\n✗ La verifica a mano non è arrivata al database (o manca la riga di registro).");
  } else {
    console.log("\n✓ Verifica a mano registrata: l'accordo entra nella coda di approvazione.");
  }
} finally {
  await contesto.close();
  await browser.close();
  await db.auth.admin.deleteUser(idPartecipante);
  await db.auth.admin.deleteUser(idAdmin);
  console.log("profili di prova cancellati");
}

process.exit(uscita);
