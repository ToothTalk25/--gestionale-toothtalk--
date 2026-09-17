/**
 * Prova del blocco dell'accesso prima che l'accordo sia completo.
 * Due casi, uno per riga: chi non ha ancora caricato l'accordo e chi l'ha
 * caricato e approvato ma senza la controfirma del Titolare.
 * Crea gli account, prova a entrare e alla fine li cancella.
 *
 *   BASE=https://gestionale-toothtalk.vercel.app node scripts/_tmp_blocco.mjs
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
const PASSWORD = "ProvaBloccoAccordo2026!";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: polo } = await db.from("poli").select("id").eq("slug", "prova").single();
const { data: mario } = await db.from("profiles").select("accordo_path").eq("email", "mario.rossi.messina@esempio.it").single();

const CASI = [
  {
    email: "prova.senza.accordo@toothtalk.local",
    nome: "Senza accordo",
    stato: {},
    deveEntrare: false,
  },
  {
    email: "prova.senza.controfirma@toothtalk.local",
    nome: "Accordo approvato, senza controfirma (approvato DOPO il 7/9)",
    stato: {
      accordo_path: mario?.accordo_path ?? "prova/accordo/finto.pdf",
      accordo_letto_confermato: true,
      accordo_verificato: "ok",
      accordo_approvato_admin_at: new Date().toISOString(),
    },
    deveEntrare: false,
  },
  {
    email: "prova.franchigia@toothtalk.local",
    nome: "Approvato PRIMA della controfirma (franchigia: deve entrare)",
    stato: {
      accordo_path: mario?.accordo_path ?? "prova/accordo/finto.pdf",
      accordo_letto_confermato: true,
      accordo_verificato: "ok",
      accordo_approvato_admin_at: "2026-09-01T10:00:00+02:00",
      accordo_scadenza: "2027-03-01",
    },
    deveEntrare: true,
  },
];

const creati = [];
for (const caso of CASI) {
  // Ripetibile: se un tentativo precedente si è interrotto, l'account di prova
  // è rimasto lì e la creazione fallirebbe con "already registered".
  const { data: residuo } = await db.from("profiles").select("id").eq("email", caso.email).maybeSingle();
  if (residuo) await db.auth.admin.deleteUser(residuo.id);

  const { data, error } = await db.auth.admin.createUser({
    email: caso.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: caso.nome },
  });
  if (error) {
    console.error("Creazione fallita per", caso.email, error.message);
    continue;
  }
  creati.push(data.user.id);
  await db.from("memberships").insert({ user_id: data.user.id, polo_id: polo.id });
  if (Object.keys(caso.stato).length) {
    await db.from("profiles").update(caso.stato).eq("id", data.user.id);
  }
}

const browser = await chromium.launch();

// Gli utenti appena creati via Admin API non sono autenticabili nell'istante
// stesso: senza questo assestamento il login fallisce per gli ultimi creati e
// la prova sembrerebbe dire "bloccato" quando invece non si è entrati affatto.
await new Promise((r) => setTimeout(r, 6000));

for (const caso of CASI) {
  // Un browser context NUOVO per ogni caso: i cookie di sessione sono
  // condivisi fra le pagine dello stesso context, e senza questo isolamento il
  // login del secondo utente partiva con la sessione del primo ancora addosso.
  const contesto = await browser.newContext();
  const page = await contesto.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(caso.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  // Il login finisce con una navigazione "soft" (router.replace): aspettare
  // l'evento load non funziona, quindi si guarda l'indirizzo finché non si
  // esce dalla pagina di login. In locale il primo server action può essere
  // lento, e un'attesa a tempo fisso darebbe risultati falsi.
  const fuoriDalLogin = async (ms = 60000) => {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
      if (!new URL(page.url()).pathname.startsWith("/login")) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  if (!(await fuoriDalLogin())) {
    console.log(`  LOGIN NON RIUSCITO per ${caso.email} — resto su ${page.url()}`);
    continue;
  }
  await page.waitForTimeout(2500);
  console.log(`\n— ${caso.nome} (${caso.email})`);
  console.log(`  atterra su: ${page.url().replace(BASE, "")}`);
  let coerente = true;
  for (const percorso of ["/dashboard", "/documenti", `/polo/${polo.id}`]) {
    await page.goto(`${BASE}${percorso}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const finale = page.url().replace(BASE, "");
    const bloccato = finale.includes("/profilo");
    if (bloccato === caso.deveEntrare) coerente = false;
    console.log(
      `  ${percorso.padEnd(44)} -> ${finale} | ${bloccato ? "bloccato" : "aperto"}` +
        `${bloccato === caso.deveEntrare ? "  ✗ INATTESO" : "  ✓"}`,
    );
  }
  console.log(`  esito: ${coerente ? "corretto" : "NON CORRETTO"}`);

  // --- navigazione coi CLIC (navigazione client: il layout NON si riesegue).
  // Era il buco: da /profilo si poteva cliccare un link del footer (Libreria
  // documenti) e da lì girare dentro l'app senza aver caricato l'accordo.
  console.log("  — con i clic (navigazione interna):");
  const link = await page.$$eval("a[href]", (as) => [
    ...new Set(as.map((a) => a.getAttribute("href") ?? "")),
  ]);
  const daProvare = link.filter(
    (l) => l.startsWith("/") && l !== "/profilo" && !l.startsWith("/privacy"),
  );
  if (daProvare.length === 0) console.log("    (nessun link interno da provare)");
  for (const percorso of daProvare) {
    await page.goto(`${BASE}/profilo`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    try {
      await page.locator(`a[href="${percorso}"]`).first().click();
      await page.waitForTimeout(2500);
      const dove = page.url().replace(BASE, "");
      const bloccato = dove.includes("/profilo");
      console.log(
        `    clic ${percorso.padEnd(22)} -> ${dove} | ${bloccato ? "bloccato" : "aperto"}` +
          `${bloccato === caso.deveEntrare ? "  ✗ INATTESO" : "  ✓"}`,
      );
    } catch {
      console.log(`    clic ${percorso.padEnd(22)} -> non cliccabile  ✓`);
    }
  }
  await contesto.close();
}
await browser.close();

for (const id of creati) await db.auth.admin.deleteUser(id);
console.log(`\naccount di prova cancellati: ${creati.length}`);
