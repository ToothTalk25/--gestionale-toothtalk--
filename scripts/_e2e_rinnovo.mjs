import { chromium } from "playwright";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const MEMBER_EMAIL = process.env.E2E_EMAIL ?? "test@toothtalk.local";
const MEMBER_PASSWORD = process.env.E2E_PASSWORD ?? "prova123";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@toothtalk.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "AdminE2e-2026!";

const risultati = [];
function ok(nome, dettaglio = "") {
  risultati.push(`OK   ${nome}`);
  console.log(`OK   ${nome}${dettaglio ? " — " + dettaglio : ""}`);
}
function fail(nome, dettaglio) {
  risultati.push(`FAIL ${nome}`);
  console.log(`FAIL ${nome} — ${dettaglio}`);
}

async function cercaUtente(email) {
  const { data, error } = await sb.from("profiles").select("id, role, attivo").eq("email", email).single();
  if (error || !data) return null;
  return data;
}

async function login(browser, email, password) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Accedi" }).click();
  // Attende che il login sia davvero completato (URL fuori da /login), non
  // un tempo fisso: il primo giro del dev server può essere lento.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

const browser = await chromium.launch();
try {
  // ---------- SETUP ----------
  // 1. Admin di test: esiste se già creato, altrimenti viene creato e
  //    portato a admin/attivo (serve per approvare il rinnovo dal pannello).
  let admin = await cercaUtente(ADMIN_EMAIL);
  if (!admin) {
    const { data, error } = await sb.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Admin E2E" },
    });
    if (error && !error.message.includes("already")) {
      throw new Error(`creazione admin: ${error.message}`);
    }
    admin = data?.user?.id ? { id: data.user.id, role: "member", attivo: false } : await cercaUtente(ADMIN_EMAIL);
  }
  if (!admin) throw new Error("admin di test non disponibile");
  const { error: eUpd } = await sb
    .from("profiles")
    .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString(), approvato_da: admin.id })
    .eq("id", admin.id);
  if (eUpd) throw new Error(`setup admin: ${eUpd.message}`);
  ok("setup: admin di test pronto", ADMIN_EMAIL);

  // 2. Collaboratore di test: spingo la scadenza dell'accordo nel passato
  //    per simulare lo stato "scaduto" (Art. 9.1). L'update passa dal
  //    service_role: il trigger fn_protect_profile lo consente.
  const membro = await cercaUtente(MEMBER_EMAIL);
  if (!membro) throw new Error(`membro ${MEMBER_EMAIL} non trovato`);
  const ieri = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { error: eScad } = await sb
    .from("profiles")
    .update({ accordo_scadenza: ieri, rinnovo_path: null, rinnovo_sha256: null, rinnovo_caricato_at: null })
    .eq("id", membro.id);
  if (eScad) throw new Error(`setup scadenza: ${eScad.message}`);
  ok("setup: scadenza accordo spostata nel passato", ieri);

  // ---------- FLUSSO MEMBRO ----------
  const { ctx: ctxMembro, page: membroPage } = await login(browser, MEMBER_EMAIL, MEMBER_PASSWORD);

  // Il login di un membro con accordo scaduto finisce GIÀ su /rinnovo.
  const urlDopoLogin = new URL(membroPage.url());
  const testoRinnovo = await membroPage.getByText("Accordo Editoriale scaduto").count();
  if (urlDopoLogin.pathname === "/rinnovo" && testoRinnovo >= 1) {
    ok("blocco: dopo il login si è su /rinnovo con avviso", urlDopoLogin.pathname);
  } else {
    fail("blocco: dopo il login su /rinnovo", `url=${urlDopoLogin.pathname} avviso=${testoRinnovo}`);
  }

  // Nessun'altra pagina dell'app è raggiungibile: /dashboard e /profilo
  // rimandano a /rinnovo (l'utente può restare SOLO lì).
  for (const destinazione of ["/dashboard", "/profilo"]) {
    await membroPage.goto(`${BASE}${destinazione}`, { waitUntil: "domcontentloaded" });
    await membroPage.waitForTimeout(2500);
    const url = new URL(membroPage.url());
    if (url.pathname === "/rinnovo") ok(`blocco: ${destinazione} rimanda a /rinnovo`);
    else fail(`blocco: ${destinazione}`, `url=${url.pathname}`);
  }

  // Caricamento del documento di rinnovo.
  await membroPage.locator('input[type="file"]').setInputFiles("/tmp/test-rinnovo.pdf");
  await membroPage.waitForTimeout(12000);

  const { rows: rCar } = await db.query(
    `select rinnovo_path, rinnovo_sha256, rinnovo_caricato_at is not null as caricato
     from profiles where email = $1`,
    [MEMBER_EMAIL],
  );
  if (rCar[0].rinnovo_path && rCar[0].rinnovo_sha256 && rCar[0].caricato) {
    ok("caricamento rinnovo", `path=${rCar[0].rinnovo_path.slice(-24)}`);
  } else {
    fail("caricamento rinnovo", JSON.stringify(rCar[0]));
  }
  const { rows: rAttesa } = await db.query(
    `select to_char(accordo_scadenza, 'YYYY-MM-DD') as scadenza from profiles where email = $1`,
    [MEMBER_EMAIL],
  );
  const ancoraScaduto = rAttesa[0].scadenza && rAttesa[0].scadenza < new Date().toISOString().slice(0, 10);
  if (ancoraScaduto) ok("blocco: resta sospeso finché non approva il Coordinatore");
  else fail("blocco: stato dopo upload", `scadenza=${rAttesa[0].scadenza}`);

  await ctxMembro.close();

  // ---------- FLUSSO ADMIN ----------
  const { ctx: ctxAdmin, page: adminPage } = await login(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
  await adminPage.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(3000);
  await adminPage.selectOption("#sezione-admin", "rinnovi-accordi");
  await adminPage.getByRole("button", { name: "Approva rinnovo" }).first().waitFor({ timeout: 15000 });
  await adminPage.getByRole("button", { name: "Approva rinnovo" }).first().click();
  await adminPage.waitForTimeout(4000);
  const { rows: rAppr } = await db.query(
    `select to_char(accordo_scadenza, 'YYYY-MM-DD') as scadenza, rinnovo_path,
            rinnovo_approvato_admin_at is not null as approvato
     from profiles where email = $1`,
    [MEMBER_EMAIL],
  );
  const scadOk = rAppr[0].scadenza > ieri;
  if (rAppr[0].approvato && rAppr[0].rinnovo_path === null && scadOk) {
    ok("approvazione rinnovo", `nuova scadenza=${rAppr[0].scadenza}`);
  } else {
    fail("approvazione rinnovo", JSON.stringify(rAppr[0]));
  }
  const { rows: rAudit } = await db.query(
    `select count(*)::int as n from audit_log where action = 'approvazione_rinnovo_accordo'`,
  );
  if (rAudit[0].n >= 1) ok("approvazione: traccia in audit_log");
  else fail("approvazione: audit_log mancante");

  await ctxAdmin.close();

  // ---------- ACCESSO RIATTIVATO ----------
  const { ctx: ctx2, page: pagina2 } = await login(browser, MEMBER_EMAIL, MEMBER_PASSWORD);
  await pagina2.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await pagina2.waitForTimeout(4000);
  const urlFinale = new URL(pagina2.url());
  if (urlFinale.pathname !== "/rinnovo") {
    ok("accesso riattivato: dashboard raggiungibile", urlFinale.pathname);
  } else {
    fail("accesso riattivato", `ancora su /rinnovo`);
  }
  await ctx2.close();

  // ---------- RINNOVO ANTICIPATO DA /PROFILO (scadenza ancora futura) ----------
  // Dopo l'approvazione precedente la scadenza è futura: il Collaboratore può
  // caricare il rinnovo in anticipo da /profilo, senza passare da /rinnovo e
  // senza perdere l'accesso nel frattempo.
  const { ctx: ctxAnt, page: paginaAnt } = await login(browser, MEMBER_EMAIL, MEMBER_PASSWORD);
  await paginaAnt.goto(`${BASE}/profilo`, { waitUntil: "domcontentloaded" });
  await paginaAnt.waitForTimeout(3000);
  const urlProfilo = new URL(paginaAnt.url());
  if (urlProfilo.pathname === "/profilo") {
    ok("anticipo: /profilo raggiungibile con scadenza futura (nessun blocco)");
  } else {
    fail("anticipo: /profilo", `url=${urlProfilo.pathname}`);
  }
  const rigaScadenza = await paginaAnt.getByText(/Il tuo Accordo scade il/).count();
  const sezioneRinnovo = await paginaAnt.getByText("Rinnovo dell'Accordo (Art. 9.1)").count();
  if (rigaScadenza >= 1 && sezioneRinnovo >= 1) {
    ok("anticipo: riga scadenza e sezione Rinnovo visibili su /profilo");
  } else {
    fail("anticipo: UI su /profilo", `riga=${rigaScadenza} sezione=${sezioneRinnovo}`);
  }

  await paginaAnt.getByTestId("file-rinnovo").setInputFiles("/tmp/test-rinnovo.pdf");
  await paginaAnt.waitForTimeout(12000);
  const { rows: rAnt } = await db.query(
    `select to_char(accordo_scadenza, 'YYYY-MM-DD') as scadenza, rinnovo_path
     from profiles where email = $1`,
    [MEMBER_EMAIL],
  );
  if (rAnt[0].rinnovo_path && rAnt[0].scadenza > new Date().toISOString().slice(0, 10)) {
    ok("anticipo: rinnovo caricato da /profilo, scadenza ancora futura", rAnt[0].scadenza);
  } else {
    fail("anticipo: caricamento da /profilo", JSON.stringify(rAnt[0]));
  }

  // L'accesso resta libero con il rinnovo in attesa: /dashboard NON rimanda a /rinnovo.
  await paginaAnt.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await paginaAnt.waitForTimeout(3000);
  const urlDash = new URL(paginaAnt.url());
  if (urlDash.pathname !== "/rinnovo") {
    ok("anticipo: dashboard raggiungibile con rinnovo in attesa", urlDash.pathname);
  } else {
    fail("anticipo: accesso perso nonostante scadenza futura", urlDash.pathname);
  }
  await ctxAnt.close();

  // Approvazione del rinnovo anticipato da parte dell'admin.
  const { ctx: ctxAppr, page: paginaAppr } = await login(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
  await paginaAppr.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await paginaAppr.waitForTimeout(3000);
  await paginaAppr.selectOption("#sezione-admin", "rinnovi-accordi");
  await paginaAppr.getByRole("button", { name: "Approva rinnovo" }).first().waitFor({ timeout: 15000 });
  await paginaAppr.getByRole("button", { name: "Approva rinnovo" }).first().click();
  await paginaAppr.waitForTimeout(4000);
  const { rows: rApprAnt } = await db.query(
    `select to_char(accordo_scadenza, 'YYYY-MM-DD') as scadenza, rinnovo_path
     from profiles where email = $1`,
    [MEMBER_EMAIL],
  );
  if (rApprAnt[0].rinnovo_path === null && rApprAnt[0].scadenza > new Date().toISOString().slice(0, 10)) {
    ok("anticipo: approvazione admin, scadenza spostata in avanti", rApprAnt[0].scadenza);
  } else {
    fail("anticipo: approvazione", JSON.stringify(rApprAnt[0]));
  }
  await ctxAppr.close();
} catch (e) {
  fail("esecuzione test", e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  await db.end();
}

const pass = risultati.filter((r) => r.startsWith("OK")).length;
console.log(`\n=== RISULTATO: ${pass}/${risultati.length} passati ===`);
process.exit(pass === risultati.length ? 0 : 1);
