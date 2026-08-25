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

const BASE = "http://localhost:3000";
const TASK = "af3cc717-eb03-43f0-bf50-3feb3022e3e1";
const risultati = [];
function ok(nome, dettaglio = "") { risultati.push(`OK   ${nome}`); console.log(`OK   ${nome}${dettaglio ? " — " + dettaglio : ""}`); }
function fail(nome, dettaglio) { risultati.push(`FAIL ${nome}`); console.log(`FAIL ${nome} — ${dettaglio}`); }

// task usa-e-getta con terzi coinvolti per il flusso di registrazione
const { rows: polo } = await db.query(`select id from poli where nome = 'Messina'`);
const { rows: utente } = await db.query(`select id from profiles where email = 'test@toothtalk.local'`);
const { rows: taskNew } = await db.query(
  `insert into tasks (titolo, status, polo_id, created_by, coinvolge_terzi)
   values ('[E2E registrazione in-app]', 'da_fare', $1, $2, true) returning id`, [polo[0].id, utente[0].id]);
const TASK_NEW = taskNew[0].id;
console.log("task usa-e-getta:", TASK_NEW);

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill("test@toothtalk.local");
  await page.locator('input[type="password"]').fill("prova123");
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForTimeout(6000);
}

// ---------- PARTE A: membro con dichiarazione già caricata ----------
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await login(page);
    await page.goto(`${BASE}/task/${TASK}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Video completo").first().waitFor({ timeout: 20000 });

    const slotText = await page.locator("#dichiarazione").innerText();
    const segnalaVisible = slotText.includes("Segnala errore");
    const nomeFile = slotText.includes("test-video.mp4");
    const bottoneRecord = await page.getByRole("button", { name: "Registra video in-app" }).count();
    const linkDownload = await page.locator('a[download], a[href*="/storage/"], a[href*="signed"]').count();
    const videoPlayer = await page.locator('#dichiarazione video').count();

    segnalaVisible && nomeFile
      ? ok("A. slot 7 compilato + Segnala errore visibile al membro")
      : fail("A. slot 7 compilato + Segnala errore", `nomeFile=${nomeFile} segnala=${segnalaVisible}`);
    bottoneRecord === 0
      ? ok("A. nessun bottone 'Registra video in-app' a slot pieno")
      : fail("A. bottone registrazione presente a slot pieno", `count=${bottoneRecord}`);
    linkDownload === 0
      ? ok("A. nessun link di download/player del file di dichiarazione in UI")
      : fail("A. link download presente", `count=${linkDownload}`);
    videoPlayer === 0
      ? ok("A. nessun player video della dichiarazione per il membro")
      : fail("A. player video presente", `count=${videoPlayer}`);

    const footer = await page.locator("#dichiarazione").innerText();
    footer.includes("solo al Coordinatore")
      ? ok("A. footer aggiornato (visibile solo al Coordinatore)")
      : fail("A. footer non aggiornato");
  } catch (e) {
    fail("Parte A", e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
  }
}
// ---------- PARTE B: registrazione in-app (camera finta) ----------
{
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 160)); });
  try {
    await login(page);
    await page.goto(`${BASE}/task/${TASK_NEW}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Video completo").first().waitFor({ timeout: 20000 });

    const bottoni = await page.getByRole("button", { name: "Registra video in-app" }).count();
    bottoni === 2
      ? ok("B. bottone 'Registra video in-app' presente negli slot 7 e 7b")
      : fail("B. bottone registrazione", `count=${bottoni}`);

    await page.locator("#dichiarazione").getByRole("button", { name: "Registra video in-app" }).click();
    await page.locator("#dichiarazione").getByText(/Registrazione…/).waitFor({ timeout: 15000 });
    ok("B. registrazione avviata (preview camera attiva)");
    await page.waitForTimeout(2500);
    await page.locator("#dichiarazione").getByRole("button", { name: "Ferma e rivedi" }).click();
    await page.locator("#dichiarazione").getByText("Rivedi il video").waitFor({ timeout: 15000 });
    const srcBlob = await page.locator("#dichiarazione video").evaluate((v) => v.src);
    srcBlob.startsWith("blob:")
      ? ok("B. revisione locale del video (blob nel browser, non sul server)")
      : fail("B. revisione locale", srcBlob.slice(0, 40));

    await page.locator("#dichiarazione").getByRole("button", { name: "Conferma e carica" }).click();
    await page.waitForTimeout(12000);

    const { rows: rVer } = await db.query(
      `select count(*)::int as n from deliverable_versions v
       join deliverables d on d.id = v.deliverable_id where d.task_id = $1`, [TASK_NEW]);
    const { rows: rEl } = await db.query(
      `select count(*)::int as n from pacchetto_elementi pe
       join pacchetti_video pv on pv.id = pe.pacchetto_id
       where pv.task_id = $1 and pe.ruolo = 'dichiarazione_identita'`, [TASK_NEW]);
    const { rows: rFile } = await db.query(
      `select v.storage_path, v.file_name, v.bucket from deliverable_versions v
       join deliverables d on d.id = v.deliverable_id where d.task_id = $1`, [TASK_NEW]);
    if (rVer[0]?.n >= 1 && rEl[0]?.n === 1 && rFile[0]) {
      ok("B. video registrato caricato e agganciato allo slot 7", `${rFile[0].file_name} (${rFile[0].bucket})`);
      const resp = await fetch(
        `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${rFile[0].bucket}/${rFile[0].storage_path}`,
        { headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY } },
      );
      const buf = new Uint8Array(await resp.arrayBuffer());
      const ebml = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
      ebml
        ? ok("B. il file in storage è un vero WebM (magic bytes EBML)")
        : fail("B. magic bytes file", `${buf[0]} ${buf[1]} ${buf[2]} ${buf[3]}`);
    } else {
      fail("B. caricamento video registrato", `versioni=${rVer[0]?.n} elementi=${rEl[0]?.n}`);
    }
  } catch (e) {
    fail("Parte B", e instanceof Error ? e.message : String(e));
    await page.screenshot({ path: "/tmp/e2e-record-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
}

// ---------- PARTE C: senza camera, errore gentile ----------
{
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await login(page);
    await page.goto(`${BASE}/task/${TASK_NEW}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Video completo").first().waitFor({ timeout: 20000 });
    // slot 7b è ancora vuoto: senza camera deve comparire un messaggio gentile
    await page.locator("#dichiarazione-integrazione").getByRole("button", { name: "Registra video in-app" }).click();
    await page.waitForTimeout(6000);
    const testo = await page.locator("#dichiarazione-integrazione").innerText();
    const tornatoIdle = await page.locator("#dichiarazione-integrazione").getByRole("button", { name: "Registra video in-app" }).count() === 1;
    const erroreGentile = /Nessuna fotocamera|Permesso negato|Registrazione non riuscita/.test(testo);
    tornatoIdle && erroreGentile
      ? ok("C. senza camera: messaggio gentile e ritorno allo stato iniziale")
      : fail("C. percorso d'errore senza camera", `idle=${tornatoIdle} messaggio=${erroreGentile}`);
  } catch (e) {
    fail("Parte C", e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
  }
}

// ---------- pulizia ----------
{
  const { rows: ver } = await db.query(
    `select v.id, v.storage_path, v.bucket from deliverable_versions v
     join deliverables d on d.id = v.deliverable_id where d.task_id = $1`, [TASK_NEW]);
  for (const v of ver) {
    const resp = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${v.bucket}/${v.storage_path}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY } },
    ).catch(() => null);
    console.log("  cleanup storage:", resp?.status ?? "skip");
  }
  await db.query(`delete from pacchetto_elementi pe using pacchetti_video pv where pv.id = pe.pacchetto_id and pv.task_id = $1`, [TASK_NEW]);
  await db.query(`delete from deliverable_versions where id = any($1::uuid[])`, [ver.map((v) => v.id)]);
  await db.query(`delete from pacchetti_video where task_id = $1`, [TASK_NEW]);
  await db.query(`delete from tasks where id = $1`, [TASK_NEW]);
  console.log("  cleanup task usa-e-getta: ok");
}

await db.end();
const pass = risultati.filter((r) => r.startsWith("OK")).length;
console.log(`\n=== RISULTATO: ${pass}/${risultati.length} passati ===`);

