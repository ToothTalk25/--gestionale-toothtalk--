/**
 * Prova reale della "rivalutazione IA" dell'accordo, in produzione.
 *
 * Crea un accesso di prova con ruolo admin, entra in /admin, cerca il blocco
 * "Verifica IA non riuscita", preme "Rivaluta con l'IA" sulla riga indicata e
 * aspetta che il profilo cambi stato nel database. Alla fine cancella
 * l'account di prova.
 *
 * Risponde a due domande in un colpo solo: (1) la rivalutazione funziona sul
 * documento già caricato, senza chiedere alla persona di ricaricarlo; (2) la
 * chiave dell'IA è raggiungibile DAL SERVER (Vercel) — che è il vero dubbio
 * quando l'esito resta "non_valutato".
 *
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_e2e_rivaluta_accordo.mjs
 *   ACCORDO_EMAIL=mari.sidoti05@gmail.com node scripts/_e2e_rivaluta_accordo.mjs
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
const EMAIL_ACCORDO = process.env.ACCORDO_EMAIL ?? "eugenia.papetti25@gmail.com";
const EMAIL_PROVA = "prova.rivaluta.ia@toothtalk.local";
const PASSWORD = "ProvaRivalutaIA2026!";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stato = async () => {
  const { data } = await db
    .from("profiles")
    .select("id, full_name, accordo_verificato, accordo_verifica_note, accordo_verificato_at")
    .eq("email", EMAIL_ACCORDO)
    .single();
  return data;
};

const prima = await stato();
if (!prima) {
  console.error(`Nessun profilo con email ${EMAIL_ACCORDO}: niente da provare.`);
  process.exit(1);
}
console.log(
  `Prima: ${prima.full_name} — esito IA "${prima.accordo_verificato}" ` +
    `(${prima.accordo_verifica_note ?? "senza nota"}) del ${prima.accordo_verificato_at}`,
);

// Accesso di prova: stessa strada dei test precedenti (ripetibile).
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL_PROVA).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);

const { data: creato, error: eCreazione } = await db.auth.admin.createUser({
  email: EMAIL_PROVA,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Prova Rivalutazione IA" },
});
if (eCreazione) {
  console.error("Creazione dell'accesso di prova fallita:", eCreazione.message);
  process.exit(1);
}
const idProva = creato.user.id;
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idProva);

const browser = await chromium.launch();
const contesto = await browser.newContext();
const page = await contesto.newPage();
let uscita = 0;

try {
  // Gli utenti appena creati via Admin API non sono autenticabili nello stesso
  // istante: senza questo assestamento il login fallirebbe e la prova
  // sembrerebbe dire "non funziona" quando invece non si è entrati affatto.
  await new Promise((r) => setTimeout(r, 6000));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(EMAIL_PROVA);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  const fine = Date.now() + 60000;
  while (Date.now() < fine && new URL(page.url()).pathname.startsWith("/login")) {
    await page.waitForTimeout(500);
  }
  if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("login non riuscito");
  console.log(`login riuscito, atterrato su ${page.url().replace(BASE, "")}`);

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const blocco = page.locator("div.border-amber-200").first();
  if ((await blocco.count()) === 0 || !(await blocco.innerText()).includes("Verifica IA non riuscita")) {
    console.log('Il blocco "Verifica IA non riuscita" non c\'è: nessun accordo da rivalutare. ✅');
  } else {
    console.log("\n— blocco trovato a schermo:\n" + (await blocco.innerText()).replace(/^/gm, "    | "));
    const riga = blocco
      .getByText(EMAIL_ACCORDO)
      .first()
      .locator("xpath=ancestor::div[contains(@class,'border-slate-200')][1]");
    if ((await riga.count()) === 0) throw new Error(`riga di ${EMAIL_ACCORDO} non trovata nel blocco`);
    console.log(
      `pulsanti "Mandami il PDF" nel blocco: ${await blocco.getByRole("button", { name: "Mandami il PDF" }).count()}`,
    );

    await riga.getByRole("button", { name: "Rivaluta con l'IA" }).click();

    // L'esito vero è quello scritto nel database: il server deve chiamare
    // l'IA, quindi qui si aspetta il cambio di stato, non un tempo fisso.
    const scadenza = Date.now() + 180000;
    let dopo = prima;
    while (Date.now() < scadenza) {
      dopo = await stato();
      if (dopo.accordo_verificato_at !== prima.accordo_verificato_at) break;
      await page.waitForTimeout(3000);
    }
    await page.waitForTimeout(2000);
    const aSchermo = await page
      .getByText(/Verifica rifatta, esito:|^Errore: /)
      .first()
      .innerText()
      .catch(() => "(messaggio non letto a schermo)");

    console.log(
      `\nDopo: esito IA "${dopo.accordo_verificato}" (${dopo.accordo_verifica_note ?? "senza nota"}) del ${dopo.accordo_verificato_at}`,
    );
    console.log(`A schermo: ${aSchermo.replace(/\s+/g, " ").trim()}`);

    const { data: registro } = await db
      .from("audit_log")
      .select("at, action, meta")
      .eq("action", "rivalutazione_ia_accordo")
      .order("at", { ascending: false })
      .limit(1);
    console.log(`Riga di registro: ${JSON.stringify(registro?.[0] ?? null)}`);

    if (dopo.accordo_verificato_at === prima.accordo_verificato_at) {
      uscita = 1;
      console.log("\n✗ L'esito NON è cambiato: la rivalutazione non è arrivata al database.");
    } else if (dopo.accordo_verificato === "ok") {
      console.log("\n✓ Rivalutazione riuscita: l'accordo è ora nella coda di approvazione.");
    } else {
      console.log(`\n△ Rivalutazione eseguita, esito "${dopo.accordo_verificato}": guarda la nota qui sopra.`);
    }
  }
} finally {
  await contesto.close();
  await browser.close();
  await db.auth.admin.deleteUser(idProva);
  console.log("account di prova cancellato");
}

process.exit(uscita);
