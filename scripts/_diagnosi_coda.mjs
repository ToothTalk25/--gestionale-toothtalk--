#!/usr/bin/env node
/**
 * La coda PEC, riga per riga: stato, contesto, impronta dell'allegato e se il
 * profilo a cui la riga si riferisce esiste ancora. Serve a distinguere i
 * residui dei collaudi (profili cancellati) dalle PEC vere. Solo lettura.
 *
 *   node scripts/_diagnosi_coda.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: righe, error } = await db
  .from("pec_da_inviare")
  .select("id, stato, creato_at, inviata_at, contesto, allegati, ultimo_errore")
  .order("creato_at", { ascending: true });
if (error) {
  console.log("ERRORE:", error.message);
  process.exit(1);
}

const { data: profili } = await db.from("profiles").select("id, email");
const vivi = new Map((profili ?? []).map((p) => [p.id, p.email]));

console.log(`Righe in coda: ${righe.length}\n`);
for (const r of righe) {
  const tipo = r.contesto?.tipo ?? "(nessun tipo)";
  const proprietario = r.contesto?.profile_id;
  const sha = (r.allegati ?? []).map((a) => String(a.sha256 ?? "").slice(0, 8)).join(",");
  const chi = proprietario ? (vivi.get(proprietario) ?? "PROFILO CANCELLATO") : "—";
  console.log(
    `${r.stato.padEnd(9)} ${tipo.padEnd(17)} ${r.creato_at.slice(0, 16)}  documento=${sha || "—"}  di=${chi}`,
  );
  if (r.ultimo_errore) console.log(`          nota: ${r.ultimo_errore}`);
}

const conteggio = {};
for (const r of righe) conteggio[r.stato] = (conteggio[r.stato] ?? 0) + 1;
console.log("\nPer stato:", conteggio);
