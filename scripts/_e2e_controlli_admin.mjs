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
function ok(n, d = "") { risultati.push("OK   " + n); console.log("OK   " + n + (d ? " — " + d : "")); }
function fail(n, d) { risultati.push("FAIL " + n); console.log("FAIL " + n + " — " + d); }

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("dialog", (d) => d.accept().catch(() => {}));
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill("test@toothtalk.local");
  await page.locator('input[type="password"]').fill("prova123");
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForTimeout(6000);
  await page.goto(`${BASE}/task/${TASK}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#dichiarazione-integrazione", { timeout: 20000 });
  await page.waitForTimeout(3000);

  const s7b = page.locator("#dichiarazione-integrazione");
  const vedi = await s7b.getByTitle("Vedi il video").count();
  const scarica = await s7b.getByTitle("Scarica il video").count();
  const elimina = await s7b.getByTitle("Elimina e libera il campo").count();
  if (vedi === 1 && scarica === 1 && elimina === 1) {
    ok("admin: icone Vedi/Scarica/Elimina presenti nello slot 7b");
  } else {
    fail("admin: icone slot 7b", `vedi=${vedi} scarica=${scarica} elimina=${elimina}`);
  }

  const s7 = page.locator("#dichiarazione");
  const s7Icone = await s7.getByTitle("Elimina e libera il campo").count();
  s7Icone === 0 ? ok("admin: nessuna icona nello slot 7 (campo già libero)") : fail("admin: icona inattesa slot 7", `n=${s7Icone}`);

  await s7b.getByTitle("Vedi il video").click();
  await page.waitForTimeout(6000);
  const video = await s7b.locator("video").count();
  let src = "";
  if (video > 0) src = await s7b.locator("video").evaluate((v) => v.src);
  if (video === 1 && src.startsWith("https://") && src.includes("/object/")) {
    ok("admin: player video caricato con URL firmato", src.slice(0, 60));
  } else {
    fail("admin: player video", `video=${video} src=${src.slice(0, 60)}`);
  }

  await s7b.getByTitle("Elimina e libera il campo").click();
  await page.getByRole("button", { name: "Elimina video", exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Elimina video", exact: true }).click();
  await page.waitForTimeout(5000);

  const rEl = await db.query(
    `select count(*)::int as n from pacchetto_elementi pe
     join pacchetti_video pv on pv.id = pe.pacchetto_id
     where pv.task_id = $1 and pe.ruolo::text = 'dichiarazione_integrazione'`, [TASK]);
  const rVer = await db.query(
    `select count(*)::int as n from deliverable_versions v
     join deliverables d on d.id = v.deliverable_id
     where d.task_id = $1 and v.file_name like '%test-video%'`, [TASK]);
  const rAudit = await db.query(
    `select count(*)::int as n from audit_log where action = 'eliminazione_dichiarazione'
     and meta->>'ruolo' = 'dichiarazione_integrazione'`);
  if (rEl.rows[0].n === 0 && rVer.rows[0].n === 0) ok("elimina: elemento e versione rimossi dal DB");
  else fail("elimina: DB non ripulito", `elementi=${rEl.rows[0].n} versioni=${rVer.rows[0].n}`);
  rAudit.rows[0].n >= 1 ? ok("elimina: audit registrato") : fail("elimina: audit mancante");

  const rObj = await db.query(
    `select count(*)::int as n from storage.objects where bucket_id = 'originali'
     and name like '%de86233d-5729-4894-aad4-406fc73b1043%'`);
  rObj.rows[0].n === 0 ? ok("elimina: oggetto storage rimosso") : fail("elimina: oggetto storage ancora presente", `n=${rObj.rows[0].n}`);
} catch (e) {
  fail("esecuzione", e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  await db.end();
}
const pass = risultati.filter((r) => r.startsWith("OK")).length;
console.log(`\n=== RISULTATO: ${pass}/${risultati.length} ===`);
