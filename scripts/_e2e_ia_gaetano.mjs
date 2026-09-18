/**
 * Prova della verifica IA su un documento che finora dava "risposta non
 * interpretabile" (quello di Gaetano: stesso file, soggetto di prova).
 *
 * Serve a capire se con il tetto di token più alto e il formato JSON richiesto
 * all'API l'esito diventa leggibile — e, se non lo diventa, a leggere che cosa
 * ha risposto davvero il modello (la nota lo riporta).
 *
 *   BASE=http://localhost:3000 node scripts/_e2e_ia_gaetano.mjs
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
const EMAIL_PERSONA = "enricoguarino25+proviaia@gmail.com";
const EMAIL_ADMIN = "prova.ia.admin@toothtalk.local";
const PASSWORD = "ProvaIa2026!";
const RIFERIMENTO = process.env.ACCORDO_EMAIL ?? "gaetano.jr.scarola@gmail.com";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: rif } = await db
  .from("profiles")
  .select("accordo_path, accordo_sha256")
  .eq("email", RIFERIMENTO)
  .single();
if (!rif?.accordo_path) {
  console.error(`Serve un accordo caricato da ${RIFERIMENTO}.`);
  process.exit(1);
}
console.log(`documento: ${rif.accordo_path.slice(-45)}`);

async function eliminaUtente(email) {
  for (let pagina = 1; pagina <= 5; pagina++) {
    const { data: lista } = await db.auth.admin.listUsers({ page: pagina, perPage: 200 });
    const utenti = lista?.users ?? [];
    const esistente = utenti.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (esistente) {
      await db.from("consents_and_releases").delete().eq("user_id", esistente.id);
      const { error } = await db.auth.admin.deleteUser(esistente.id);
      if (error) console.log(`  (pulizia ${email}: ${error.message})`);
    }
    if (utenti.length < 200) break;
  }
}
async function creaUtente(email, nome) {
  await eliminaUtente(email);
  const { data, error } = await db.auth.admin.createUser({
    email,


    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: nome },
  });
  if (error) throw new Error(`creazione ${email}: ${error.message}`);
  return data.user.id;
}
const idPersona = await creaUtente(EMAIL_PERSONA, "Prova IA Accordo");
const idAdmin = await creaUtente(EMAIL_ADMIN, "Prova Accesso Globale");

await db
  .from("profiles")
  .update({
    attivo: true,
    approvato_at: new Date().toISOString(),
    on_screen: false,
    accordo_path: rif.accordo_path,
    accordo_sha256: rif.accordo_sha256,
    accordo_caricato_at: new Date().toISOString(),
    accordo_letto_confermato: true,
    accordo_verificato: "non_valutato",
    accordo_verifica_note: "Risposta IA non interpretabile.",
    accordo_verificato_at: new Date().toISOString(),
  })
  .eq("id", idPersona);
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idAdmin);

const browser = await chromium.launch();
let uscita = 0;

async function entra(page, email, password) {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Accedi" }).click();
    const fine = Date.now() + 30000;
    while (Date.now() < fine) {
      if (!new URL(page.url()).pathname.startsWith("/login")) return true;
      await page.waitForTimeout(500);
    }
    console.log(`  (${email}: ancora su /login, tentativo ${tentativo})`);
    if (tentativo < 3) await page.reload({ waitUntil: "domcontentloaded" });
  }
  return false;
}

try {
  await new Promise((r) => setTimeout(r, 6000));
  const pagina = await browser.newPage();
  pagina.on("pageerror", (e) => console.log("  [errore pagina]", e.message.slice(0, 200)));
  await pagina.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (!(await entra(pagina, EMAIL_ADMIN, PASSWORD))) throw new Error("login admin non riuscito");
  console.log("admin: login riuscito");

  await pagina.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(3000);
  await pagina.selectOption("#sezione-admin", "accordi-da-approvare");
  await pagina.waitForTimeout(3000);

  const blocco = pagina.locator("section").filter({ hasText: "Verifica IA non riuscita" }).first();
  const riga = blocco
    .getByText(EMAIL_PERSONA, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-slate-200')][1]");
  if ((await riga.count()) === 0) throw new Error("riga della persona di prova non trovata");
  console.log(`riga trovata (i pulsanti sono sempre a destra):\n${(await riga.innerText()).replace(/^/gm, "    | ")}`);

  const prima = await db
    .from("profiles")
    .select("accordo_verificato_at")
    .eq("id", idPersona)
    .single();
  const istantePrima = new Date(prima.data?.accordo_verificato_at ?? 0).getTime();

  console.log("\nclicco «Rivaluta con l'IA» e aspetto (può richiedere un minuto)…");
  await riga.getByRole("button", { name: "Rivaluta con l'IA" }).click();

  // La verifica è conclusa quando il database registra un esito NUOVO: si
  // guarda il dato, non il tempo.
  const scadenza = Date.now() + 180000;
  let esito = null;
  let nota = null;
  while (Date.now() < scadenza) {
    const { data } = await db
      .from("profiles")
      .select("accordo_verificato, accordo_verifica_note, accordo_verificato_at")
      .eq("id", idPersona)
      .single();
    esito = data?.accordo_verificato ?? null;
    nota = data?.accordo_verifica_note ?? null;
    const quando = new Date(data?.accordo_verificato_at ?? 0).getTime();
    if (quando > istantePrima + 1000 && (esito !== "non_valutato" || (nota ?? "").length > 45)) break;
    await pagina.waitForTimeout(3000);
  }

  console.log(`\nesito dopo la rivalutazione: ${esito}`);
  console.log(`nota: ${nota}`);
  const aSchermo = await pagina
    .getByText(/Verifica rifatta|Errore:/)
    .first()
    .innerText()
    .catch(() => "(messaggio non letto a schermo)");
  console.log(`a schermo: ${aSchermo.replace(/\s+/g, " ").trim().slice(0, 300)}`);

  if (esito && esito !== "non_valutato") {
    console.log("\n✓ Il modello ha risposto in modo leggibile: l'esito è una valutazione, non un guasto.");
  } else {
    console.log(`\n⚠️ Esito ancora non leggibile; la nota dice: ${nota}`);
    uscita = 1;
  }
} finally {
  await browser.close();
  await eliminaUtente(EMAIL_PERSONA);
  await eliminaUtente(EMAIL_ADMIN);
  console.log("profili di prova cancellati (le persone vere non sono state toccate)");
}

process.exit(uscita);
