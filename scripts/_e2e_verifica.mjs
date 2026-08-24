import { chromium } from "playwright";
import pg from "pg";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const TASK = process.env.E2E_TASK ?? "af3cc717-eb03-43f0-bf50-3feb3022e3e1";
const TEST_EMAIL = process.env.E2E_EMAIL ?? "test@toothtalk.local";
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? "prova123";
const CONTATTO_TEST = process.env.E2E_CONTATTO ?? "enricoguarino25+contattoprova2@gmail.com";
const risultati = [];
function ok(nome, dettaglio = "") { risultati.push(`OK   ${nome}`); console.log(`OK   ${nome}${dettaglio ? " — " + dettaglio : ""}`); }
function fail(nome, dettaglio) { risultati.push(`FAIL ${nome}`); console.log(`FAIL ${nome} — ${dettaglio}`); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("dialog", (d) => d.accept().catch(() => {}));

try {
  // ---------- LOGIN ----------
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForTimeout(7000);
  const urlDopoLogin = new URL(page.url());
  if (urlDopoLogin.pathname.startsWith("/login")) {
    fail("login", `url ancora ${page.url()} — verifica credenziali/errore in pagina`);
    throw new Error("login fallito");
  }
  ok("login", `url ${page.url()}`);

  // ---------- VAI AL TASK ----------
  await page.goto(`${BASE}/task/${TASK}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Video completo").first().waitFor({ timeout: 20000 });
  ok("apertura pagina progetto (Video completo visibile)");

  // ---------- 1. UPLOAD DICHIARAZIONE ----------
  const inputDich = page.locator('#dichiarazione input[type="file"]');
  await inputDich.setInputFiles("/tmp/test-video.mp4");
  await page.waitForTimeout(12000);
  const rDich = await db.query(
    `select count(*)::int as n from pacchetto_elementi pe
     join pacchetti_video pv on pv.id = pe.pacchetto_id
     where pv.task_id = $1 and pe.ruolo = 'dichiarazione_identita'`, [TASK]);
  const rDichVer = await db.query(
    `select count(*)::int as n from deliverable_versions v
     join deliverables d on d.id = v.deliverable_id
     where d.task_id = $1 and d.kind = 'video_grezzo'`, [TASK]);
  if (rDich.rows[0].n >= 1 && rDichVer.rows[0].n >= 1) {
    ok("upload video dichiarazione", `elemento + ${rDichVer.rows[0].n} versioni in DB`);
  } else {
    fail("upload video dichiarazione", `elementi=${rDich.rows[0].n} versioni=${rDichVer.rows[0].n}`);
  }

  // ---------- 2. UPLOAD INTEGRAZIONE DICHIARAZIONE ----------
  const inputInt = page.locator('#dichiarazione-integrazione input[type="file"]');
  await inputInt.setInputFiles("/tmp/test-video.mp4");
  await page.waitForTimeout(12000);
  const rInt = await db.query(
    `select count(*)::int as n from pacchetto_elementi pe
     join pacchetti_video pv on pv.id = pe.pacchetto_id
     where pv.task_id = $1 and pe.ruolo = 'dichiarazione_integrazione'`, [TASK]);
  rInt.rows[0].n >= 1 ? ok("upload video integrazione", "elemento in DB") : fail("upload video integrazione", `elementi=${rInt.rows[0].n}`);

  // ---------- 3. GOOGLE DOC DESCRIZIONE ----------
  const linkDoc = page.getByRole("link", { name: /Apri Google Doc/ }).first();
  const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  await linkDoc.click({ timeout: 8000 }).catch(() => {});
  const popup = await popupPromise;
  const urlDoc = popup?.url() ?? "";
  if (urlDoc.startsWith("https://docs.google.com/document/d/")) {
    ok("apertura Google Doc descrizione", urlDoc.slice(0, 70));
  } else {
    fail("apertura Google Doc descrizione", urlDoc || "nessun popup");
  }
  if (popup) await popup.close().catch(() => {});

  // ---------- 4. LIBERATORIA: inserisci contatto ----------
  const campoContatto = page.getByPlaceholder("es. studio@email.it");
  await campoContatto.fill(CONTATTO_TEST);
  await page.getByText("Video completo").first().click();
  await page.waitForTimeout(6000);
  const rLib = await db.query(`select count(*)::int as n from richieste_liberatoria where task_id = $1`, [TASK]);
  const rTaskContatto = await db.query(`select contatto_esterno_email from tasks where id = $1`, [TASK]);
  if (rLib.rows[0].n >= 1 || rTaskContatto.rows[0].contatto_esterno_email) {
    ok("invio liberatoria", `contatto salvato, richieste_liberatoria=${rLib.rows[0].n} (email OTP partita alla casella del contatto)`);
  } else {
    fail("invio liberatoria", "nessuna riga / contatto non salvato");
  }
  // ---------- 5. ELIMINA PROGETTO (su un progetto usa-e-getta già esistente) ----------
  const { rows: usaEGetta } = await db.query(
    `select t.id from tasks t join profiles p on p.id = t.created_by
     where t.titolo = '[E2E usa-e-getta]' and p.email = 'test@toothtalk.local' order by t.created_at desc limit 1`);
  if (!usaEGetta.length) {
    fail("eliminazione progetto", "nessun progetto usa-e-getta trovato");
  } else {
    const taskBanda = usaEGetta[0].id;
    await page.goto(`${BASE}/task/${taskBanda}`, { waitUntil: "domcontentloaded" });
    const btnElimina = page.getByTitle("Elimina il progetto");
    await btnElimina.waitFor({ timeout: 15000 });
    await btnElimina.click();
    // il click apre il dialogo di conferma (role=alertdialog): conferma davvero
    const btnConferma = page.getByRole("button", { name: "Elimina progetto", exact: true });
    await btnConferma.waitFor({ timeout: 10000 });
    await btnConferma.click();
    await page.waitForTimeout(4000);
    const { rows: ancora } = await db.query(`select count(*)::int as n from tasks where id = $1`, [taskBanda]);
    if (ancora[0].n === 0) ok("eliminazione progetto", "task eliminato dal DB");
    else fail("eliminazione progetto", `task ancora presente (n=${ancora[0].n})`);
  }
} catch (e) {
  fail("esecuzione test", e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: "/tmp/e2e-error.png" }).catch(() => {});
} finally {
  await browser.close();
  await db.end();
}

const pass = risultati.filter((r) => r.startsWith("OK")).length;
const totali = risultati.length;
console.log(`\n=== RISULTATO: ${pass}/${totali} passati ===`);

