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
for (const caso of CASI) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(caso.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForTimeout(8000);
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
  await page.close();
}
await browser.close();

for (const id of creati) await db.auth.admin.deleteUser(id);
console.log(`\naccount di prova cancellati: ${creati.length}`);
