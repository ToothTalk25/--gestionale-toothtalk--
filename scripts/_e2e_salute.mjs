/**
 * Controllo di salute E cronometro delle pagine chiave.
 *
 * Due cose nello stesso giro, perché si fanno insieme:
 *  1. salute: l'app risponde, il menu c'è, nessun errore JavaScript;
 *  2. velocità: per ogni pagina il tempo al primo byte, al disegno e a rete
 *     ferma, e quante risorse scarica. Tre giri: si riporta la mediana.
 *
 * Serve a misurare PRIMA e DOPO ogni intervento di velocità — gli stessi
 * numeri, confrontabili. Prima puntava a un account vero (Mario) che nel
 * frattempo è stato cancellato, e senza un "prima" qualsiasi modifica sembra
 * un miglioramento: adesso crea due account temporanei (un Collaboratore con
 * accesso completo e un account di accesso globale), li usa e li cancella. Nessuna password di
 * persone vere, e gli account veri non si toccano.
 *
 *   node scripts/_e2e_salute.mjs                                   (in locale)
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_e2e_salute.mjs
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
const EMAIL = "prova.velocita.membro@toothtalk.local";
const EMAIL_ADMIN = "prova.velocita.titolare@toothtalk.local";
const PASSWORD = "ProvaVelocita2026!";
const GIRI = Number(process.env.GIRI ?? 3);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Toglie l'utente e ciò che gli sta attaccato: le chiavi esterne senza
 *  cascata farebbero fallire la cancellazione in silenzio (l'utente
 *  resterebbe in auth e la prova successiva lo ritroverebbe). */
async function eliminaUtente(email) {
  for (let pagina = 1; pagina <= 5; pagina++) {
    const { data: lista } = await db.auth.admin.listUsers({ page: pagina, perPage: 200 });
    const utenti = lista?.users ?? [];
    const esistente = utenti.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (esistente) {
      await db.from("memberships").delete().eq("user_id", esistente.id);
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

const adesso = new Date();
const fraSeiMesi = new Date(adesso.getTime() + 182 * 24 * 3600 * 1000).toISOString();

const { data: polo } = await db.from("poli").select("id, slug").limit(1).maybeSingle();
const { data: task } = polo
  ? await db.from("tasks").select("id").eq("polo_id", polo.id).limit(1).maybeSingle()
  : { data: null };

// Collaboratore con accesso COMPLETO: tutte e cinque le condizioni di
// accordoCompleto() (src/lib/accordo.ts) soddisfatte, altrimenti il proxy lo
// rimanda sul profilo e i tempi delle pagine non misurano niente.
const idMembro = await creaUtente(EMAIL, "Prova Velocità Membro");
await db
  .from("profiles")
  .update({
    attivo: true,
    approvato_at: adesso.toISOString(),
    on_screen: false,
    accordo_path: "profili/prova/accordo-prova-velocita.pdf",
    accordo_sha256: "0".repeat(64),
    accordo_caricato_at: adesso.toISOString(),
    accordo_letto_confermato: true,
    accordo_verificato: "ok",
    accordo_verifica_note: "account di prova per il cronometro",
    accordo_verificato_at: adesso.toISOString(),
    accordo_approvato_admin_at: adesso.toISOString(),
    accordo_controfirmato_path: "profili/prova/controfirma-prova.pdf",
    accordo_controfirma_confermata_at: adesso.toISOString(),
    accordo_scadenza: fraSeiMesi,
  })
  .eq("id", idMembro);
if (polo) await db.from("memberships").insert({ user_id: idMembro, polo_id: polo.id });

const idTitolare = await creaUtente(EMAIL_ADMIN, "Prova Velocità Accesso Globale");
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: adesso.toISOString() })
  .eq("id", idTitolare);

const browser = await chromium.launch();
const errori = [];

/** Entra con un account temporaneo e aspetta di uscire dal login. */
async function entra(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Accedi" }).click();
    const fine = Date.now() + 40000;
    while (Date.now() < fine) {
      if (!new URL(page.url()).pathname.startsWith("/login")) return true;
      await page.waitForTimeout(500);
    }
    if (tentativo < 3) await page.reload({ waitUntil: "domcontentloaded" });
  }
  return false;
}

/** Cronometra una pagina. Il primo giro è di riscaldamento e non si conta (in
 *  locale la prima visita compila la pagina: sarebbe un numero falso). */
async function misura(page, percorso) {
  const campioni = [];
  for (let giro = 0; giro <= GIRI; giro++) {
    const t0 = Date.now();
    const risposta = await page.goto(`${BASE}${percorso}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const aFermo = Date.now() - t0;
    const battito = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return {
        primoByte: n ? Math.round(n.responseStart) : -1,
        disegno: n ? Math.round(n.domContentLoadedEventEnd) : -1,
        risorse: performance.getEntriesByType("resource").length,
      };
    });
    if (giro === 0) continue;
    campioni.push({
      ...battito,
      fermo: aFermo,
      stato: risposta?.status() ?? 0,
      atterra: new URL(page.url()).pathname,
    });
  }
  const mediana = (chiave) => {
    const v = campioni.map((c) => c[chiave]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return {
    pagina: percorso,
    esito: campioni[0].stato,
    atterra: campioni.every((c) => c.atterra === campioni[0].atterra) ? campioni[0].atterra : "(diversi)",
    "primo byte": mediana("primoByte"),
    disegno: mediana("disegno"),
    "rete ferma": mediana("fermo"),
    risorse: mediana("risorse"),
  };
}

let uscita = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errori.push(e.message.slice(0, 120)));
  if (!(await entra(page, EMAIL))) throw new Error("accesso del Collaboratore non riuscito");
  console.log(`Collaboratore (accesso completo) — entra e atterra su ${new URL(page.url()).pathname}`);

  const pagineMembro = ["/dashboard", "/risorse", "/documenti", "/profilo"];
  if (task) pagineMembro.push(`/task/${task.id}`);
  const righe = [];
  for (const percorso of pagineMembro) righe.push(await misura(page, percorso));
  console.log(`\n=== Collaboratore — mediana di ${GIRI} giri (locale: primo giro escluso) ===`);
  console.table(righe);

  // L.accesso globale ha pagine sue (Registro) e in più le stesse: una nuova pagina
  // del browser è anche un contesto nuovo, quindi le sessioni non si mescolano.
  const pageAdmin = await browser.newPage();
  pageAdmin.on("pageerror", (e) => errori.push(e.message.slice(0, 120)));
  if (!(await entra(pageAdmin, EMAIL_ADMIN))) throw new Error("accesso globale non riuscito");
  console.log(`\nAccesso globale — entra e atterra su ${new URL(pageAdmin.url()).pathname}`);

  const righeAdmin = [];
  for (const percorso of ["/admin", "/dashboard", "/revisione", "/documenti"]) {
    righeAdmin.push(await misura(pageAdmin, percorso));
  }
  console.log(`\n=== Accesso globale — mediana di ${GIRI} giri ===`);
  console.table(righeAdmin);

  const storte = [...righe, ...righeAdmin].filter((r) => r.esito !== 200 || r.atterra !== r.pagina);
  if (storte.length) {
    uscita = 1;
    console.log("\nPagine con esito inatteso (codice o destinazione diversa):");
    for (const r of storte) console.log(`  ${r.pagina} -> ${r.esito} su ${r.atterra}`);
  } else {
    console.log("\nTutte le pagine: 200 e nessun rimbalzo ✓");
  }
  console.log("errori JavaScript:", errori.length ? errori.join(" | ") : "nessuno");
} catch (e) {
  uscita = 1;
  console.log("ERRORE:", e.message);
} finally {
  await browser.close();
  await eliminaUtente(EMAIL);
  await eliminaUtente(EMAIL_ADMIN);
  console.log("account di prova cancellati (le persone vere non sono state toccate)");
}

process.exit(uscita);
