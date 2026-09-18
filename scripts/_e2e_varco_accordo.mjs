/**
 * Prova reale del varco dell'Accordo nel database (0137), in produzione.
 *
 * La falla chiusa era questa: con una sessione valida ma l'Accordo
 * incompleto si poteva chiamare l'API direttamente — PostgREST con la chiave
 * anon, che il browser ha — e leggere i progetti del proprio gruppo,
 * saltando il blocco che vive nell'app. Qui si prova esattamente quel
 * percorso, con account creati e cancellati sul momento (chiave anon, nessun
 * service_role: quella è la richiesta che fa un browser).
 *
 *  1. membro attivo SENZA Accordo        → 0 progetti, ma profilo leggibile
 *  2. stesso membro con Accordo COMPLETO → vede i progetti del suo gruppo
 *  3. stesso membro con Accordo SCADUTO  → 0 progetti
 *  4. accesso globale di prova           → vede tutti i progetti
 *
 *   BASE_API=https://<progetto>.supabase.co node scripts/_e2e_varco_accordo.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const riga of readFileSync(".env.local", "utf8").split("\n")) {
  const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL_API = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = "ProvaVarcoAccordo2026!";
const EMAIL_MEMBRO = "prova.varco.membro@toothtalk.local";
const EMAIL_ADMIN = "prova.varco.admin@toothtalk.local";

const admin = createClient(URL_API, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const crea = async (email, nome) => {
  const { data: residuo } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (residuo) await admin.auth.admin.deleteUser(residuo.id);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: nome },
  });
  if (error) throw new Error(`creazione ${email}: ${error.message}`);
  return data.user.id;
};

// Un gruppo che ha davvero progetti, così "0" e "qualche progetto" si
// distinguono davvero.
const { data: unProgetto } = await admin.from("tasks").select("polo_id").limit(1).single();
const { count: progettiDelGruppo } = await admin
  .from("tasks")
  .select("*", { count: "exact", head: true })
  .eq("polo_id", unProgetto.polo_id);
const { count: progettiInTutto } = await admin.from("tasks").select("*", { count: "exact", head: true });
console.log(`gruppo di prova: ${progettiDelGruppo} progetti; in tutto: ${progettiInTutto}`);

const idMembro = await crea(EMAIL_MEMBRO, "Prova Varco Membro");
const idAdminProva = await crea(EMAIL_ADMIN, "Prova Varco Accesso Globale");

await admin.from("memberships").insert({ user_id: idMembro, polo_id: unProgetto.polo_id });
await admin
  .from("profiles")
  .update({ attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idMembro);
await admin
  .from("profiles")
  .update({ role: "admin", attivo: true, approvato_at: new Date().toISOString() })
  .eq("id", idAdminProva);

// Chi fa la richiesta è un browser: chiave anon + sessione dell'utente.
// Nessun service_role qui sotto, altrimenti la prova salterebbe la RLS.
const sessione = async (email) => {
  const client = createClient(URL_API, ANON, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`accesso ${email}: ${error.message}`);
  return client;
};

const conta = async (client, tabella) => {
  const { count, error } = await client.from(tabella).select("*", { count: "exact", head: true });
  return error ? `errore: ${error.message}` : count;
};

// fn_protect_profile lascia scrivere i campi dell'Accordo al service_role:
// è la stessa strada che usa il gestionale quando approva.
const accordo = async (campi) => {
  const { error } = await admin.from("profiles").update(campi).eq("id", idMembro);
  if (error) throw new Error(`accordo di prova: ${error.message}`);
};

// Gli utenti appena creati non sono autenticabili nello stesso istante.
await new Promise((r) => setTimeout(r, 6000));
const comeMembro = await sessione(EMAIL_MEMBRO);
const comeAdmin = await sessione(EMAIL_ADMIN);

const esiti = {};

esiti["membro senza accordo"] = {
  progetti: await conta(comeMembro, "tasks"),
  materiali: await conta(comeMembro, "deliverables"),
  profili: await conta(comeMembro, "profiles"),
};

await accordo({
  accordo_path: "prova/accordo.pdf",
  accordo_letto_confermato: true,
  accordo_verificato: "ok",
  accordo_approvato_admin_at: new Date().toISOString(),
  accordo_controfirmato_path: null,
  accordo_controfirma_confermata_at: new Date().toISOString(),
  accordo_scadenza: null,
});
esiti["membro con accordo completo"] = { progetti: await conta(comeMembro, "tasks") };

await accordo({ accordo_scadenza: new Date(Date.now() - 86400000).toISOString().slice(0, 10) });
esiti["membro con accordo scaduto ieri"] = { progetti: await conta(comeMembro, "tasks") };

await accordo({ accordo_scadenza: new Date().toISOString().slice(0, 10) });
esiti["accordo che scade oggi"] = { progetti: await conta(comeMembro, "tasks") };

esiti["accesso globale di prova"] = { progetti: await conta(comeAdmin, "tasks") };

console.log("");
for (const [nome, r] of Object.entries(esiti)) console.log(`${nome.padEnd(30)} ${JSON.stringify(r)}`);

const attesi = [
  ["senza Accordo: 0 progetti", esiti["membro senza accordo"].progetti === 0],
  ["senza Accordo: 0 materiali", esiti["membro senza accordo"].materiali === 0],
  ["senza Accordo: il proprio profilo resta leggibile", esiti["membro senza accordo"].profili >= 1],
  ["con Accordo completo: vede il suo gruppo", esiti["membro con accordo completo"].progetti === progettiDelGruppo],
  ["Accordo scaduto ieri: 0 progetti", esiti["membro con accordo scaduto ieri"].progetti === 0],
  ["Accordo che scade oggi: ancora valido", esiti["accordo che scade oggi"].progetti === progettiDelGruppo],
  ["accesso globale: vede tutti i progetti", esiti["accesso globale di prova"].progetti === progettiInTutto],
];

let falliti = 0;
console.log("");
for (const [descrizione, ok] of attesi) {
  if (!ok) falliti++;
  console.log(`${ok ? "✓" : "✗"} ${descrizione}`);
}

await admin.auth.admin.deleteUser(idMembro);
await admin.auth.admin.deleteUser(idAdminProva);
console.log(`\naccount di prova cancellati — esito: ${falliti === 0 ? "tutto corretto" : `${falliti} prove fallite`}`);
process.exit(falliti === 0 ? 0 : 1);
