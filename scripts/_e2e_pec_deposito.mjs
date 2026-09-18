/**
 * Prova reale del pulsante "Metti in coda la PEC del deposito".
 *
 * Serve per i depositi rimasti senza PEC (firma arrivata durante il blocco di
 * Aruba): il pulsante rimanda ESATTAMENTE il documento caricato dalla persona,
 * con la sua impronta, e pretende una frase di conferma che resta nel registro.
 *
 * Prova anche lo STATO della riga dopo il clic (difetto segnalato: "ho messo la
 * PEC in coda ma il tasto spunta lo stesso"): con la PEC in coda o spedita il
 * pulsante non c'è più e la riga lo dice; con la riga annullata o in errore la
 * PEC non esiste, e il pulsante torna a disposizione (è il caso di Marianna, i
 * cui tentativi sono righe annullate).
 *
 * La persona di prova punta all'accordo vero di Marianna (stesso file: nessun
 * documento inventato). Nessuna PEC parte da qui: la riga viene cancellata alla
 * fine, e i profili di prova cancellati.
 *
 *   BASE=http://localhost:3000 node scripts/_e2e_pec_deposito.mjs
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
const EMAIL_PERSONA = "enricoguarino25+provadeposito@gmail.com";
const EMAIL_ADMIN = "prova.deposito.admin@toothtalk.local";
const PASSWORD = "ProvaDeposito2026!";
const RIFERIMENTO = process.env.ACCORDO_EMAIL ?? "mari.sidoti05@gmail.com";
const CONFERMA =
  "Prova end-to-end: guardato tutto il PDF, firma manoscritta in fondo, dati anagrafici presenti.";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: rif } = await db
  .from("profiles")
  .select("accordo_path, accordo_sha256")
  .eq("email", RIFERIMENTO)
  .single();
if (!rif?.accordo_path) {
  console.error(`Serve un accordo caricato da ${RIFERIMENTO} per puntarci la prova.`);
  process.exit(1);
}
console.log(`documento di riferimento: ${rif.accordo_path.slice(-40)}`);
console.log(`impronta: ${rif.accordo_sha256?.slice(0, 16)}…`);

async function eliminaUtente(email) {
  for (let pagina = 1; pagina <= 5; pagina++) {
    const { data: lista } = await db.auth.admin.listUsers({ page: pagina, perPage: 200 });
    const utenti = lista?.users ?? [];
    const esistente = utenti.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (esistente) {
      // consents_and_releases ha una chiave esterna senza cascata: senza questa
      // riga l'eliminazione fallisce in silenzio e l'utente resta in auth.
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

const idPersona = await creaUtente(EMAIL_PERSONA, "Prova PEC Deposito");
const idAdmin = await creaUtente(EMAIL_ADMIN, "Prova Accesso Globale");

// La persona di prova ha un accordo VERO caricato, con esito ok: finisce nella
// lista principale ("Accordi da approvare"), dove sta Marianna.
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
    accordo_verificato: "ok",
    accordo_verifica_note: "prova end-to-end",
    accordo_verificato_at: new Date().toISOString(),
  })
  .eq("id", idPersona);
await db
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idAdmin);

const browser = await chromium.launch();
let uscita = 0;

/** Entra e aspetta di uscire dal login (riempie dopo l'idratazione, e riprova). */
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

  const riga = pagina
    .getByText(EMAIL_PERSONA, { exact: true })
    .first()
    .locator("xpath=ancestor::div[contains(@class,'border-slate-200')][1]");
  if ((await riga.count()) === 0) throw new Error("riga della persona di prova non trovata");
  console.log(`riga trovata:\n${(await riga.innerText()).replace(/^/gm, "    | ")}`);

  await riga.getByRole("button", { name: "Metti in coda la PEC del deposito" }).click();
  await riga.locator("textarea").fill(CONFERMA);
  await riga.getByRole("button", { name: "Metti la PEC in coda" }).click();
  await pagina.waitForTimeout(5000);

  const messaggio1 = await pagina
    .getByText(/PEC messa in coda|già la sua PEC|Errore: /)
    .first()
    .innerText()
    .catch(() => "(messaggio non letto)");
  console.log(`\na schermo: ${messaggio1.replace(/\s+/g, " ").trim()}`);

  const { data: coda } = await db
    .from("pec_da_inviare")
    .select("id, stato, oggetto, destinatari, copia_conoscenza, allegati, contesto")
    // Solo le righe della persona di prova: se in coda c'è una PEC vera di
    // qualcun altro (succede: la coda è di lavoro), questa pulizia non la tocca.
    .filter("contesto->>profile_id", "eq", idPersona);
  const righe = coda ?? [];
  console.log(`\nrighe in coda: ${righe.length}`);
  for (const r of righe) {
    console.log(
      `  • ${r.oggetto}\n      a: ${r.destinatari.join(", ")} | cc: ${(r.copia_conoscenza ?? []).join(", ")}\n      allegati: ${(r.allegati ?? []).map((a) => a.nome).join(", ")} | contesto: ${JSON.stringify(r.contesto)}`,
    );
  }

  const { data: registro } = await db
    .from("audit_log")
    .select("action, meta")
    .eq("action", "pec_deposito_messa_in_coda")
    .eq("entity_id", idPersona);
  console.log(`riga di registro: ${registro?.length ? "presente ✓" : "MANCANTE ✗"}`);

  const allegatoGiusto = righe.some((r) =>
    (r.allegati ?? []).some((a) => a.sha256 === rif.accordo_sha256),
  );
  console.log(`allegato con l'impronta del documento caricato: ${allegatoGiusto ? "sì ✓" : "NO ✗"}`);
  const copiaAllaPersona = righe.some((r) => (r.copia_conoscenza ?? []).includes(EMAIL_PERSONA));
  console.log(`copia alla persona: ${copiaAllaPersona ? "sì ✓" : "NO ✗"}`);

  // Stato della riga dopo il clic: la PEC c'è, quindi il pulsante non deve più
  // comparire — è il difetto segnalato ("ho messo la PEC in coda ma il tasto
  // spunta lo stesso"). La riga deve invece dire che fine ha fatto.
  const leggiRiga = async () => {
    await pagina.reload({ waitUntil: "domcontentloaded" });
    await pagina.waitForTimeout(3000);
    await pagina.selectOption("#sezione-admin", "accordi-da-approvare");
    await pagina.waitForTimeout(2500);
    const r = pagina
      .getByText(EMAIL_PERSONA, { exact: true })
      .first()
      .locator("xpath=ancestor::div[contains(@class,'border-slate-200')][1]");
    return {
      riga: r,
      testo: (await r.innerText()).replace(/\s+/g, " ").trim(),
      pulsante: await r.getByRole("button", { name: "Metti in coda la PEC del deposito" }).count(),
    };
  };

  const dopoClic = await leggiRiga();
  console.log(`\ndopo il clic — pulsanti "Metti in coda la PEC del deposito": ${dopoClic.pulsante}`);
  console.log(`dice: ${dopoClic.testo}`);

  // Il computer spedisce davvero la PEC (è quello che fa il Mac ogni 15 minuti):
  // la riga si aggiorna e il pulsante resta via.
  const idRiga = righe[0]?.id;
  if (idRiga) {
    await db
      .from("pec_da_inviare")
      .update({ stato: "inviata", inviata_at: new Date().toISOString(), message_id: "prova-end-to-end" })
      .eq("id", idRiga);
  }
  const dopoInvio = await leggiRiga();
  console.log(`\ndopo l'invio — pulsanti: ${dopoInvio.pulsante}`);
  console.log(`dice: ${dopoInvio.testo}`);

  // Riga annullata (o in errore): la PEC NON c'è, e il pulsante deve tornare a
  // disposizione — è il caso di Marianna, i cui tentativi sono tutti annullati.
  if (idRiga) {
    await db
      .from("pec_da_inviare")
      .update({ stato: "annullata", ultimo_errore: "riga di prova end-to-end" })
      .eq("id", idRiga);
  }
  const dopoAnnullo = await leggiRiga();
  console.log(`\ndopo l'annullo — pulsanti: ${dopoAnnullo.pulsante}`);
  console.log(`dice: ${dopoAnnullo.testo}`);

  const okStato =
    dopoClic.pulsante === 0 &&
    /PEC del deposito in coda/.test(dopoClic.testo) &&
    dopoInvio.pulsante === 0 &&
    /PEC del deposito spedita il/.test(dopoInvio.testo) &&
    dopoAnnullo.pulsante === 1 &&
    /annullato/.test(dopoAnnullo.testo);

  if (!righe.length || !allegatoGiusto || !copiaAllaPersona || !registro?.length || !okStato) {
    uscita = 1;
    console.log("\n✗ Qualcosa non torna: leggi sopra.");
  } else {
    console.log(
      "\n✓ Pulsante ok: PEC in coda col documento caricato, copia alla persona, riga di registro." +
        "\n✓ Stato ok: in coda e spedita il pulsante non c'è (lo dice la riga); annullata torna.",
    );
  }

  // Pulizia: la riga della prova non è una PEC vera e non deve restare in coda.
  // Si annulla (non si cancella: 0139 non concede il delete a nessuno, e la riga
  // resta come traccia di quello che è stato fatto).
  for (const r of righe) {
    await db
      .from("pec_da_inviare")
      .update({
        stato: "annullata",
        ultimo_errore: "riga di prova end-to-end",
        aggiornato_at: new Date().toISOString(),
      })
      .eq("id", r.id);
  }
  console.log("righe di prova annullate (non vanno spedite)");
} finally {
  await browser.close();
  await eliminaUtente(EMAIL_PERSONA);
  await eliminaUtente(EMAIL_ADMIN);
  console.log("profili di prova cancellati (le persone vere non sono state toccate)");
}

process.exit(uscita);

