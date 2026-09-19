#!/usr/bin/env node
/**
 * Diagnostica dei permessi: cosa può fare chi non ha la sessione, e le tre
 * funzioni di sola manutenzione. In sola lettura, tranne la creazione e la
 * cancellazione di un utente di prova (per verificare che il trigger di
 * creazione profilo funzioni ancora dopo la 0144).
 *
 *   node scripts/_diagnosi_permessi.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Con un limite di tempo: senza, un problema di rete sembra un blocco. */
const entro = (p, ms, che) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("tempo scaduto: " + che)), ms))]);

const esito = (r) => (r.error ? `VIETATO (${r.error.message.slice(0, 60)})` : "PERMESSO");

try {
  // 1. I percorsi pubblici devono funzionare senza sessione.
  const invito = await entro(anon.rpc("verifica_invito", { p_codice: "PROVA-8G4W" }), 15000, "verifica_invito");
  console.log("verifica_invito senza sessione:", esito(invito));

  const onboarding = await entro(anon.rpc("verifica_token_onboarding", { p_token: "x" }), 15000, "onboarding");
  console.log("verifica_token_onboarding senza sessione:", esito(onboarding));

  // 2. Tutto il resto deve essere vietato senza sessione.
  const annulla = await entro(
    anon.rpc("annulla_pacchetto", { p_pacchetto: "00000000-0000-0000-0000-000000000000", p_motivo: "prova" }),
    15000,
    "annulla_pacchetto",
  );
  console.log("annulla_pacchetto senza sessione:", esito(annulla));

  const elimina = await entro(
    anon.rpc("elimina_progetto", { p_task: "00000000-0000-0000-0000-000000000000" }),
    15000,
    "elimina_progetto",
  );
  console.log("elimina_progetto senza sessione:", esito(elimina));

  const integrita = await entro(anon.rpc("controlla_integrita", { p_origine: "prova" }), 15000, "integrita");
  console.log("controlla_integrita senza sessione:", esito(integrita));

  const pec = await entro(
    anon.rpc("registra_esito_pec", {
      p_pacchetto: "00000000-0000-0000-0000-000000000000",
      p_stato: "bozza",
      p_message_id: null,
      p_destinatari: [],
      p_errore: null,
      p_note: null,
    }),
    15000,
    "registra_esito_pec",
  );
  console.log("registra_esito_pec senza sessione:", esito(pec));

  const consuma = await entro(
    anon.rpc("consuma_invito", { p_codice: "PROVA-8G4W", p_user: null, p_email: "x@y.z" }),
    15000,
    "consuma_invito",
  );
  console.log("consuma_invito senza sessione:", esito(consuma));

  // 3. Letture che nessuno deve poter fare senza sessione.
  const poli = await entro(anon.from("poli").select("id").limit(1), 15000, "lettura poli");
  console.log("lettura poli senza sessione:", esito({ error: poli.error, data: poli.data?.length ? "righe" : null }));

  const profili = await entro(anon.from("profiles").select("id").limit(1), 15000, "lettura profili");
  console.log("lettura profili senza sessione:", esito({ error: profili.error, data: profili.data?.length ? "righe" : null }));

  // 4. La creazione di un account (che passa dal trigger handle_new_user)
  //    deve continuare a funzionare: è il cuore della registrazione.
  const email = `prova.diagnosi.${Date.now()}@toothtalk.local`;
  const creato = await entro(
    admin.auth.admin.createUser({
      email,
      password: "DiagnosiPermessi2026",
      email_confirm: true,
      user_metadata: { full_name: "Prova Diagnosi" },
    }),
    20000,
    "creazione utente",
  );
  console.log("creazione account + trigger profilo:", creato.error ? "FALLITA " + creato.error.message : "ok");
  if (creato.data?.user) {
    const { data: profilo } = await admin.from("profiles").select("id, full_name").eq("id", creato.data.user.id).maybeSingle();
    console.log("  profilo creato dal trigger:", profilo ? `sì (${profilo.full_name})` : "NO ✗");
    await admin.auth.admin.deleteUser(creato.data.user.id);
    console.log("  utente di prova cancellato");
  }
} catch (e) {
  console.log("PROBLEMA:", e.message);
}
