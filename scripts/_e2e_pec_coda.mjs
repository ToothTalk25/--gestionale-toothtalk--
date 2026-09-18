/**
 * Prova reale della coda PEC (0139): mette in coda le PEC degli accordi che
 * sono rimasti senza data certa, cliccando il pulsante vero dell'interfaccia
 * ("Metti la PEC in coda" nella sezione Richieste di registrazione).
 *
 * Perché così e non scrivendo le righe a mano: il percorso da verificare è
 * quello dell'applicazione, non un'imitazione. Se il pulsante non scrive in
 * coda, questa prova lo dice.
 *
 * Nessuna PEC parte da qui: la spedizione è di `npm run pec -- --esegui`.
 *
 *   BASE=http://localhost:3000 node scripts/_e2e_pec_coda.mjs
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
const EMAIL_ADMIN = "prova.coda.pec@toothtalk.local";
const PASSWORD = "ProvaCodaPec2026!";
// Le persone a cui l'accordo è stato mandato SOLO per email: la PEC con data
// certa non è mai arrivata (ticket Aruba 19039798A).
const NOMI = [
  "Giada Tripodi",
  "Marianna Sidoti",
  "Enrico Maria Guarino",
  "Eugenia Papetti",
  "Agnese Campus",
  "Michele Grioni",
  "Gaetano Scarola",
];

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function contaInCoda() {
  const { count } = await db
    .from("pec_da_inviare")
    .select("id", { count: "exact", head: true })
    .eq("stato", "in_coda");
  return count ?? 0;
}

// Admin di prova: serve solo a poter cliccare. Viene cancellato alla fine.
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL_ADMIN).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);
const { data: creato, error: eCreazione } = await db.auth.admin.createUser({
  email: EMAIL_ADMIN,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: "Prova Coda PEC" },
});
if (eCreazione) throw new Error(`creazione admin di prova: ${eCreazione.message}`);
const idAdmin = creato.user.id;
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idAdmin);

const browser = await chromium.launch();
const contesto = await browser.newContext();
const page = await contesto.newPage();
let uscita = 0;


try {
  // Gli utenti creati via Admin API non sono autenticabili nello stesso istante.
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
  console.log("login riuscito");

  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.selectOption("#sezione-admin", "richieste");
  await page.waitForTimeout(3000);

  const blocco = page.locator("section").filter({ hasText: "Accordi da certificare via PEC" }).first();
  if ((await blocco.count()) === 0) throw new Error('blocco "Accordi da certificare via PEC" non trovato');

  for (const nome of NOMI) {
    const riga = blocco
      .getByText(nome, { exact: true })
      .first()
      .locator("xpath=ancestor::div[contains(@class,'border-amber-200')][1]");
    if ((await riga.count()) === 0) {
      console.log(`  ! ${nome}: riga non trovata`);
      uscita = 1;
      continue;
    }
    await riga.getByRole("button", { name: "Metti la PEC in coda" }).click();
    await page.waitForTimeout(2500);
    console.log(`  → ${nome}: cliccato`);
  }

  // Idempotenza: un secondo clic sulla stessa persona non deve creare una
  // seconda PEC (due certificazioni dello stesso documento non servono).
  const primaDelSecondoClic = await contaInCoda();
  const rigaGiada = blocco
    .getByText("Giada Tripodi", { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-amber-200')][1]");
  await rigaGiada.getByRole("button", { name: /Metti la PEC in coda|Metto in coda/ }).click();
  await page.waitForTimeout(2500);
  const dopoIlSecondoClic = await contaInCoda();
  const messaggio = await page
    .getByText(/già in coda|Messa in coda|Errore:/)
    .first()
    .innerText()
    .catch(() => "(messaggio non letto)");
  console.log(`\nsecondo clic su Giada — prima: ${primaDelSecondoClic}, dopo: ${dopoIlSecondoClic}`);
  console.log(`messaggio a schermo: ${messaggio.replace(/\s+/g, " ").trim()}`);

  // La sezione nuova del Registro deve mostrare quello che c'è in coda.
  await page.selectOption("#sezione-admin", "pec-in-coda");
  await page.waitForTimeout(3000);
  const sezione = page.locator("section").filter({ hasText: "PEC da spedire" }).first();
  const testoSezione = (await sezione.innerText()).replace(/\s+/g, " ").trim();
  console.log(`\nsezione "PEC da spedire" a schermo:\n  ${testoSezione.slice(0, 700)}`);

  const inCoda = await contaInCoda();
  console.log(`\nrighe in coda nel database: ${inCoda} (attese: ${NOMI.length})`);

  const { data: righe } = await db
    .from("pec_da_inviare")
    .select("oggetto, destinatari, copia_conoscenza, allegati, contesto")
    .eq("stato", "in_coda")
    .order("creato_at");
  for (const r of righe ?? []) {
    console.log(
      `  • ${r.oggetto}\n      a: ${r.destinatari.join(", ")} | cc: ${(r.copia_conoscenza ?? []).join(", ") || "—"} | allegati: ${(r.allegati ?? []).length} | ${JSON.stringify(r.contesto)}`,
    );
  }

  if (inCoda !== NOMI.length || dopoIlSecondoClic !== primaDelSecondoClic) {
    uscita = 1;
    console.log("\n✗ Qualcosa non torna (numero di righe in coda o idempotenza).");
  } else {
    console.log("\n✓ Le PEC sono in coda, una per persona, e il secondo clic non ha duplicato.");
  }
} finally {
  await contesto.close();
  await browser.close();
  await db.auth.admin.deleteUser(idAdmin);
  console.log("admin di prova cancellato (le persone vere non sono state toccate)");
}

process.exit(uscita);
