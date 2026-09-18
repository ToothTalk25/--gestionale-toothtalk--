/**
 * Prova reale dell'integrità dei depositi (0138), in produzione.
 *
 * Verifica tre cose che devono essere vere tutte insieme:
 *  1. la sveglia notturna esiste davvero nel database (job pg_cron);
 *  2. il pulsante "Controlla adesso" nel Registro funziona e scrive la riga;
 *  3. la sezione "Integrità dei depositi" mostra l'esito.
 *
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_e2e_integrita.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = "prova.integrita@toothtalk.local";
const PASSWORD = "ProvaIntegrita2026!";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- 1. la sveglia notturna esiste?
const sql = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await sql.connect();
const job = await sql.query(`select jobname, schedule, active from cron.job where jobname = 'controllo-integrita-notte'`);
console.log("sveglia notturna nel database:", JSON.stringify(job.rows));
if (job.rows.length !== 1) console.log("✗ il job pg_cron non c'è");
const ultimaPrima = await sql.query(
  `select count(*)::int as n, max(eseguita_at) as ultima from public.controlli_integrita`,
);
console.log("controlli registrati finora:", JSON.stringify(ultimaPrima.rows[0]));

// --- pulizia di un eventuale residuo, poi accesso di prova
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);
const { data: creato, error: eCrea } = await db.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Prova Integrità" },
});
if (eCrea) throw new Error(eCrea.message);
const idProva = creato.user.id;
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idProva);

let uscita = 0;
const browser = await chromium.launch();
const contesto = await browser.newContext();
const page = await contesto.newPage();
page.on("pageerror", (e) => console.log("  [errore pagina]", e.message.slice(0, 200)));

try {
  // Gli utenti appena creati non sono autenticabili nello stesso istante.
  await new Promise((r) => setTimeout(r, 6000));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  const fine = Date.now() + 60000;
  while (Date.now() < fine && new URL(page.url()).pathname.startsWith("/login")) {
    await page.waitForTimeout(500);
  }
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("login non riuscito");

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.selectOption("#sezione-admin", "integrita");
  await page.waitForTimeout(3000);

  const sezione = page.getByText("Integrità dei depositi", { exact: false }).first();
  console.log(`\nsezione trovata: ${(await sezione.innerText()).split("\n")[0]}`);
  console.log(
    "esito mostrato prima del clic:",
    (await page.locator("section").last().innerText()).split("\n").slice(0, 4).join(" | "),
  );

  await page.getByRole("button", { name: "Controlla adesso" }).click();
  const esito = await page
    .getByText(/Tutto integro:|Problemi trovati:|Errore: /)
    .first()
    .innerText({ timeout: 60000 });
  console.log(`messaggio a schermo: ${esito.replace(/\s+/g, " ").trim()}`);

  // --- la riga scritta dal pulsante
  const { data: riga } = await db
    .from("controlli_integrita")
    .select("origine, esito, deliverable_controllate, versioni_controllate, pacchetti_controllati, problemi, eseguita_at")
    .eq("origine", "manuale")
    .order("eseguita_at", { ascending: false })
    .limit(1);
  console.log("riga scritta dal pulsante:", JSON.stringify(riga?.[0] ?? null));

  const ok1 = job.rows.length === 1 && job.rows[0].active === true;
  const ok2 = riga?.[0]?.esito === "integro" || riga?.[0]?.esito === "problemi";
  const ok3 = esito.includes("Tutto integro") || esito.includes("Problemi trovati");
  if (!ok1 || !ok2 || !ok3) uscita = 1;

  console.log("");
  console.log(`${ok1 ? "✓" : "✗"} sveglia notturna attiva nel database`);
  console.log(`${ok2 ? "✓" : "✗"} "Controlla adesso" scrive la riga nel registro`);
  console.log(`${ok3 ? "✓" : "✗"} la sezione mostra l'esito`);
} finally {
  await contesto.close();
  await browser.close();
  await sql.end();
  await db.auth.admin.deleteUser(idProva);
  console.log(uscita === 0 ? "\ntutto corretto (accesso di prova cancellato)" : "\nqualcosa non torna");
}

process.exit(uscita);

