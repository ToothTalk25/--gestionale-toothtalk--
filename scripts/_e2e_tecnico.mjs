import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

/**
 * Prova end-to-end dell'accesso del Collaboratore Tecnico (ruolo 'tecnico',
 * migrazioni 0133-0135): cosa vede davvero, cosa può scrivere, e cosa vede
 * il partecipante dopo la risposta.
 *
 * Serve il server di sviluppo attivo (npm run dev) e la password dell'accesso
 * del Collaboratore Tecnico in .env.local:
 *
 *   TECNICO_PASSWORD=...       (credenziale vera: NON va scritta nel repo)
 *
 *   node scripts/_e2e_tecnico.mjs
 *
 * Crea una domanda tecnica di prova e la cancella alla fine.
 */
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL_TECNICO = "tecnico@toothtalk.local";
const PASSWORD_TECNICO = env.TECNICO_PASSWORD;
// Il partecipante che fa la domanda è creato da questa prova (non si usa più
// un account esterno: quello di prova è stato disattivato).
const EMAIL_PARTECIPANTE = "prova.domanda@toothtalk.local";
const PASSWORD_PARTECIPANTE = "ProvaDomandaTecnica2026!";

if (!PASSWORD_TECNICO) {
  console.error("Manca TECNICO_PASSWORD in .env.local (password dell'accesso del Collaboratore Tecnico).");
  process.exit(1);
}

let fallimenti = 0;
function verifica(titolo, cond, extra = "") {
  if (!cond) fallimenti++;
  console.log(`${cond ? "OK  " : "KO  "} ${titolo}${extra ? ` — ${extra}` : ""}`);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Il partecipante che pone la domanda: creato qui, cancellato alla fine.
const { data: residuo } = await admin
  .from("profiles")
  .select("id")
  .eq("email", EMAIL_PARTECIPANTE)
  .maybeSingle();
if (residuo) await admin.auth.admin.deleteUser(residuo.id);

const { data: nuovoPartecipante, error: ePartecipante } = await admin.auth.admin.createUser({
  email: EMAIL_PARTECIPANTE,
  password: PASSWORD_PARTECIPANTE,
  email_confirm: true,
  user_metadata: { full_name: "Prova Zeta" },
});
if (ePartecipante) {
  console.error("Creazione del partecipante fallita:", ePartecipante.message);
  process.exit(1);
}
const partecipante = { id: nuovoPartecipante.user.id };
verifica("partecipante di prova creato", !!partecipante.id, EMAIL_PARTECIPANTE);

const { data: altraDomanda } = await admin
  .from("domande_supporto")
  .select("id")
  .eq("categoria_ia", "altro")
  .limit(1)
  .maybeSingle();

const testoDomanda = "[PROVA E2E] Che pasta lucidante consigliate per lo zirconio?";
const testoRisposta = "Per lo zirconio consiglio pasta a base di ossido di alluminio, grana fine.";
const { data: nuova } = await admin
  .from("domande_supporto")
  .insert({ user_id: partecipante.id, domanda: testoDomanda, categoria_ia: "tecnica" })
  .select("id")
  .single();
verifica("domanda tecnica di prova creata", !!nuova, nuova?.id ?? "");

// -------------------------------------------- perimetro (con la SUA sessione)
const tecnico = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data: loginT, error: eT } = await tecnico.auth.signInWithPassword({
  email: EMAIL_TECNICO,
  password: PASSWORD_TECNICO,
});
verifica("accede con le sue credenziali", !eT && !!loginT?.session, eT?.message ?? "");
if (!loginT?.session) process.exit(1);
const idTecnico = loginT.session.user.id;

const { data: viste } = await tecnico.from("domande_supporto").select("id, categoria_ia");
verifica(
  "vede solo le domande tecniche",
  (viste ?? []).every((d) => d.categoria_ia === "tecnica"),
  `${viste?.length ?? 0} righe`,
);
const { data: profili } = await tecnico.from("profiles").select("id");
verifica(
  "vede solo il proprio profilo",
  (profili ?? []).length === 1 && profili[0].id === idTecnico,
  `${profili?.length ?? 0} righe`,
);
const { data: nome } = await tecnico.rpc("nome_battesimo", { p_user: partecipante.id });
verifica("di chi chiede vede solo il nome di battesimo", nome === "Prova", `«${nome}»`);
if (altraDomanda) {
  verifica("non vede le domande di altro tipo", !(viste ?? []).some((d) => d.id === altraDomanda.id));
}

// ---------------------------------------------------- la sua pagina /tecnico
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(EMAIL_TECNICO);
  await page.locator('input[type="password"]').fill(PASSWORD_TECNICO);
  await page.getByRole("button", { name: "Accedi" }).click();
  await page.waitForURL(/\/tecnico/, { timeout: 25000 });
  verifica("dopo l'accesso atterra sulla sua pagina /tecnico", page.url().includes("/tecnico"), page.url());

  await page.getByText(testoDomanda).first().waitFor({ timeout: 20000 });
  verifica("la domanda tecnica compare nella pagina", true);
  verifica(
    "vede il nome di battesimo di chi chiede",
    (await page.getByText("Prova", { exact: true }).count()) > 0,
  );
  const contenuto = await page.content();
  verifica("non compare il cognome di chi chiede", !contenuto.includes("Zeta"));

  await page.locator("textarea").first().fill(testoRisposta);
  await page.getByRole("button", { name: /Invia risposta/ }).click();
  // La pagina si aggiorna da sola (router.refresh): la domanda esce da quelle
  // in attesa e passa tra le risposte.
  const appare = async (loc, ms = 30000) => {
    try {
      await loc.first().waitFor({ timeout: ms });
      return true;
    } catch {
      return false;
    }
  };
  const testoRispostaVisibile = await appare(page.getByText(testoRisposta));
  verifica("la risposta inviata compare subito nella pagina", testoRispostaVisibile);
  const sezioneRisposte = await appare(page.getByText("Domande già risposte"));
  verifica(
    "la domanda passa tra quelle già risposte",
    sezioneRisposte,
    sezioneRisposte ? "" : (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 400),
  );

  // Se prova a entrare nell'app dei partecipanti, torna sulla sua pagina.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/tecnico/, { timeout: 20000 });
  verifica("dall'app dei partecipanti viene rimandato a /tecnico", page.url().includes("/tecnico"), page.url());
} catch (e) {
  verifica("la pagina /tecnico funziona per intero", false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}

// ----------------------------------- cosa resta scritto, e cosa vede il partecipante
const { data: dopo } = await admin
  .from("domande_supporto")
  .select("domanda, risposta, risposto_da, risposto_at")
  .eq("id", nuova.id)
  .single();
verifica(
  "risposta salvata e attribuita al Collaboratore Tecnico",
  dopo?.risposta === testoRisposta && dopo?.risposto_da === idTecnico,
);
verifica("il testo della domanda è intatto", dopo?.domanda === testoDomanda);

const partecipanteClient = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
await partecipanteClient.auth.signInWithPassword({ email: EMAIL_PARTECIPANTE, password: PASSWORD_PARTECIPANTE });
const { data: sue } = await partecipanteClient.from("domande_supporto").select("id, risposta");
verifica(
  "il partecipante vede la risposta del Collaboratore Tecnico",
  (sue ?? []).find((d) => d.id === nuova.id)?.risposta === testoRisposta,
);

// ---------------------------------------------------------------------- pulizia
const { error: eDel } = await admin.from("domande_supporto").delete().eq("id", nuova.id);
verifica("domanda di prova rimossa", !eDel, eDel?.message ?? "");

const { error: eUtente } = await admin.auth.admin.deleteUser(partecipante.id);
verifica("partecipante di prova cancellato", !eUtente, eUtente?.message ?? "");

console.log(fallimenti === 0 ? "\nTutti i controlli superati." : `\n${fallimenti} controlli falliti.`);
process.exit(fallimenti === 0 ? 0 : 1);
