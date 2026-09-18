/**
 * Prova reale delle tre aggiunte del 0140, sul percorso vero dell'applicazione:
 *
 *   1. l'accesso globale chiede di ricaricare l'accordo (motivo obbligatorio,
 *      email alla persona, riga nel registro);
 *   2. la persona lo vede nel proprio profilo;
 *   3. quando ricarica, la richiesta si chiude da sola, riceve una email di
 *      conferma e la PEC del deposito ha la persona in copia (anche se non ha
 *      una PEC: prima la copia arrivava solo a chi ne aveva una).
 *
 * La persona di prova punta all'accordo di una persona vera (stesso file:
 * nessun documento inventato) e la sua email è un alias di Enrico, così le due
 * email della prova arrivano davvero in una casella invece che nel vuoto.
 * Alla fine si cancellano i profili di prova, il file caricato e la riga di
 * coda (marcata annullata: non va spedita, il documento non è suo).
 *
 *   BASE=http://localhost:3000 node scripts/_e2e_ricarica.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL_PERSONA = process.env.EMAIL_PROVA ?? "enricoguarino25+provaricarica@gmail.com";
const EMAIL_ADMIN = "prova.ricarica.admin@toothtalk.local";
const PASSWORD = "ProvaRicarica2026!";
const RIFERIMENTO = process.env.ACCORDO_EMAIL ?? "eugenia.papetti25@gmail.com";
const MOTIVO =
  "Il PDF che ci è arrivato ha una pagina sola su nove: serve la scansione completa dell'accordo firmato, con la firma in fondo all'ultima pagina.";
const FILE_LOCALE = "/tmp/accordo_prova_ricarica.pdf";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Il documento di riferimento (una persona vera, un accordo vero) e la sua copia
// locale da dare al browser come file da caricare.
const { data: rif } = await db
  .from("profiles")
  .select("accordo_path")
  .eq("email", RIFERIMENTO)
  .single();
if (!rif?.accordo_path) {
  console.error(`Serve un accordo caricato da ${RIFERIMENTO} per puntarci la prova.`);
  process.exit(1);
}
const { data: blob } = await db.storage.from("profili").download(rif.accordo_path);
if (!blob) {
  console.error("Accordo di riferimento non scaricabile dallo storage.");
  process.exit(1);
}
writeFileSync(FILE_LOCALE, Buffer.from(await blob.arrayBuffer()));
console.log(`file di prova: ${FILE_LOCALE} (${Math.round(Buffer.byteLength(await blob.arrayBuffer()) / 1024)} KB)`);

async function creaUtente(email, nome) {
  // La riga in profiles può non esserci ma l'utente in auth sì: succede quando
  // una prova precedente è stata interrotta a metà, e in quel caso la creazione
  // fallisce con "already registered". Si cerca l'utente vero e lo si toglie di
  // mezzo (le pagine si scorrono: l'elenco può essere più lungo di una pagina).
  for (let pagina = 1; pagina <= 5; pagina++) {
    const { data: lista } = await db.auth.admin.listUsers({ page: pagina, perPage: 200 });
    const utenti = lista?.users ?? [];
    const esistente = utenti.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (esistente) await db.auth.admin.deleteUser(esistente.id);
    if (utenti.length < 200) break;
  }

  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: nome },
  });
  if (error) throw new Error(`creazione ${email}: ${error.message}`);
  return data.user.id;
}

const idPersona = await creaUtente(EMAIL_PERSONA, "Prova Ricarica Accordo");
const idAdmin = await creaUtente(EMAIL_ADMIN, "Prova Accesso Globale");

// La persona di prova è a tutti gli effetti una persona che ha caricato: stesso
// file di riferimento, lettura confermata, esito automatico non "ok" (è il caso
// in cui si chiede di ricaricare). Anagrafica completa: caricaAccordo la esige.
await db
  .from("profiles")
  .update({
    attivo: true,
    approvato_at: new Date().toISOString(),
    on_screen: false,
    data_nascita: "1999-05-04",
    luogo_nascita: "Genova",
    codice_fiscale: "PRVRCR99E04D969X",
    accordo_path: rif.accordo_path,
    accordo_letto_confermato: true,
    accordo_verificato: "errato",
    accordo_verifica_note: "prova end-to-end: pagina singola",
    accordo_verificato_at: new Date().toISOString(),
  })
  .eq("id", idPersona);
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idAdmin);

const browser = await chromium.launch();
let uscita = 0;

/**
 * Entra e aspetta di uscire dalla pagina di login.
 *
 * Riempie lui i campi, dopo aver aspettato l'idratazione: se il campo viene
 * riempito prima, React non registra il valore e il modulo parte con i campi
 * VUOTI — è successo davvero (il log del server registrava un accesso con
 * email e password vuote, e la prova sembrava dire "login fallito" mentre il
 * login non era mai stato chiesto con i dati giusti). Se dopo il clic si resta
 * sulla pagina, si ricarica e si riprova: in locale la prima richiesta dopo
 * una modifica ai file può cadere mentre il server compila.
 */
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
    console.log(`  (${email}: ancora su /login dopo il clic, tentativo ${tentativo})`);
    if (tentativo < 3) await page.reload({ waitUntil: "domcontentloaded" });
  }
  const errori = await page.locator(".text-red-600").allInnerTexts().catch(() => []);
  console.log(`  errore a schermo: ${JSON.stringify(errori)}`);
  return false;
}

try {
  // Gli utenti creati via Admin API non sono autenticabili nello stesso istante.
  await new Promise((r) => setTimeout(r, 6000));

  // ---------------------------------------- 1. l'accesso globale chiede la ricarica
  const contestoAdmin = await browser.newContext();
  const paginaAdmin = await contestoAdmin.newPage();
  await paginaAdmin.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (!(await entra(paginaAdmin, EMAIL_ADMIN, PASSWORD))) throw new Error("login admin non riuscito");
  console.log("admin: login riuscito");

  await paginaAdmin.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await paginaAdmin.waitForTimeout(3000);
  await paginaAdmin.selectOption("#sezione-admin", "accordi-da-approvare");
  await paginaAdmin.waitForTimeout(3000);

  const blocco = paginaAdmin.locator("section").filter({ hasText: "Verifica IA non riuscita" }).first();
  const riga = blocco
    .getByText(EMAIL_PERSONA, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-slate-200')][1]");
  if ((await riga.count()) === 0) {
    throw new Error("riga della persona di prova non trovata fra gli accordi da verificare");
  }
  console.log(`admin: riga trovata\n${(await riga.innerText()).replace(/^/gm, "    | ")}`);

  await riga.getByRole("button", { name: "Chiedi di ricaricare" }).click();
  await riga.locator("textarea").fill(MOTIVO);
  await riga.getByRole("button", { name: "Chiedi il ricaricamento" }).click();
  await paginaAdmin.waitForTimeout(4000);

  const { data: dopoRichiesta } = await db
    .from("profiles")
    .select("accordo_ricarica_richiesta_at, accordo_ricarica_motivo")
    .eq("id", idPersona)
    .single();
  const { data: registro } = await db
    .from("audit_log")
    .select("at, action, meta")
    .eq("action", "richiesta_ricaricamento_accordo")
    .eq("entity_id", idPersona);

  console.log(
    `\nrichiesta registrata: ${dopoRichiesta?.accordo_ricarica_richiesta_at ?? "NO — MANCANTE"}`,
  );
  console.log(`motivo: ${(dopoRichiesta?.accordo_ricarica_motivo ?? "").slice(0, 70)}…`);
  console.log(`riga di registro: ${registro?.length ? "presente ✓" : "MANCANTE ✗"}`);
  if (!dopoRichiesta?.accordo_ricarica_richiesta_at || !registro?.length) {
    uscita = 1;
    console.log("✗ La richiesta non è arrivata dove doveva.");
  }
  await contestoAdmin.close();

  // ------------------------------------- 2. la persona vede l'avviso e ricarica
  const contestoPersona = await browser.newContext();
  const pagina = await contestoPersona.newPage();
  pagina.on("pageerror", (e) => console.log("  [errore pagina]", e.message.slice(0, 200)));
  await pagina.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  if (!(await entra(pagina, EMAIL_PERSONA, PASSWORD))) throw new Error("login persona non riuscito");
  console.log("\npersona: login riuscito");

  await pagina.goto(`${BASE}/profilo`, { waitUntil: "domcontentloaded" });
  await pagina.waitForTimeout(3000);
  const avviso = pagina.getByText("Ci serve di nuovo il tuo accordo firmato").first();
  const avvisoPresente = (await avviso.count()) > 0;
  console.log(`persona: avviso nel profilo → ${avvisoPresente ? "presente ✓" : "ASSENTE ✗"}`);
  if (avvisoPresente) {
    const testoAvviso = (await avviso.locator("xpath=ancestor::div[1]").innerText())
      .replace(/\s+/g, " ")
      .trim();
    console.log(`  testo: ${testoAvviso.slice(0, 240)}`);
  }
  if (!avvisoPresente) uscita = 1;


  // Il caricamento: prima la spunta "ho letto e compreso", poi il file.
  const sezioneAccordo = pagina.locator("section").filter({ hasText: "Accordo editoriale" }).first();
  await sezioneAccordo.locator('input[type="checkbox"]').check();
  await pagina.waitForTimeout(500);
  await sezioneAccordo.locator('input[type="file"]').setInputFiles(FILE_LOCALE);
  console.log("persona: file consegnato al browser, attendo il controllo automatico…");

  const scadenza = Date.now() + 180000;
  let dopoCaricamento = null;
  while (Date.now() < scadenza) {
    const { data } = await db
      .from("profiles")
      .select("accordo_path, accordo_ricarica_richiesta_at, accordo_caricato_at")
      .eq("id", idPersona)
      .single();
    dopoCaricamento = data;
    // La richiesta si chiude quando l'accordo nuovo è registrato: è quello il
    // segnale che caricaAccordo ha fatto il suo lavoro.
    if (data?.accordo_ricarica_richiesta_at === null) break;
    await pagina.waitForTimeout(3000);
  }

  const esitoSchermo = await pagina
    .getByText(/Accordo caricato|Errore/)
    .first()
    .innerText()
    .catch(() => "(messaggio non letto a schermo)");
  console.log(`\npersona: a schermo → ${esitoSchermo.replace(/\s+/g, " ").trim().slice(0, 200)}`);
  console.log(
    `richiesta chiusa da sola: ${dopoCaricamento?.accordo_ricarica_richiesta_at === null ? "sì ✓" : "NO ✗"} (accordo caricato: ${dopoCaricamento?.accordo_caricato_at ?? "—"})`,
  );
  if (dopoCaricamento?.accordo_ricarica_richiesta_at !== null) uscita = 1;

  // La riga di coda arriva DOPO: caricaAccordo registra il documento, poi fa il
  // controllo automatico (che può durare decine di secondi) e solo alla fine
  // accoda la PEC. Fermarsi al primo segnale farebbe dire alla prova una cosa
  // falsa — è successo: la riga c'era, dodici secondi dopo.
  let rigaCoda = null;
  const scadenzaCoda = Date.now() + 180000;
  while (Date.now() < scadenzaCoda && !rigaCoda) {
    const { data: coda } = await db
      .from("pec_da_inviare")
      .select("id, oggetto, destinatari, copia_conoscenza, allegati, stato")
      .eq("stato", "in_coda")
      .order("creato_at", { ascending: false });
    rigaCoda = (coda ?? []).find((r) => (r.copia_conoscenza ?? []).includes(EMAIL_PERSONA)) ?? null;
    if (!rigaCoda) await pagina.waitForTimeout(3000);
  }
  console.log(
    `\nPEC in coda con la persona in copia: ${rigaCoda ? "sì ✓" : "NO ✗"}${
      rigaCoda ? `\n    a: ${rigaCoda.destinatari.join(", ")}\n    cc: ${(rigaCoda.copia_conoscenza ?? []).join(", ")}\n    allegati: ${(rigaCoda.allegati ?? []).map((a) => a.nome).join(", ")}` : ""
    }`,
  );
  if (!rigaCoda) uscita = 1;

  // ------------------------------------------------ pulizia (niente resta)
  if (rigaCoda) {
    await db.from("pec_da_inviare").update({ stato: "annullata", aggiornato_at: new Date().toISOString() }).eq("id", rigaCoda.id);
    console.log("riga di coda della prova marcata annullata (non va spedita: il documento non è suo)");
  }
  if (dopoCaricamento?.accordo_path) {
    await db.storage.from("profili").remove([dopoCaricamento.accordo_path]);
  }

  console.log(
    uscita === 0
      ? "\n✓ Tutto come deve: richiesta con motivo e registro, avviso nel profilo, richiesta chiusa al ricaricamento, copia della PEC alla persona."
      : "\n✗ Qualcosa non torna: leggi sopra.",
  );
} finally {
  await browser.close();
  for (const id of [idPersona, idAdmin].filter(Boolean)) {
    // Le righe che tengono in piedi il profilo: consents_and_releases ha una
    // chiave esterna SENZA cascata, quindi senza toglierla l'eliminazione
    // dell'utente fallisce in silenzio e l'utente resta in auth — è successo
    // davvero, e la prova successiva trovava "già registrato".
    await db.from("consents_and_releases").delete().eq("user_id", id);
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) console.log(`  (pulizia non riuscita per ${id}: ${error.message})`);
  }
  console.log("profili di prova cancellati (le persone vere non sono state toccate)");
}

process.exit(uscita);

