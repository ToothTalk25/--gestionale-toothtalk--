#!/usr/bin/env node
/**
 * Quanto costa la lettura del Registro, e dove — in sola lettura.
 *
 * Il gestionale legge le ultime 80 operazioni da audit_log ordinandole per
 * data. Questa diagnostica rifà la stessa query con EXPLAIN ANALYZE, ma
 * IMPERSONANDO l'utente collegato (ruolo authenticated + claims del JWT): è
 * l'unico modo per far valere le policy RLS come in produzione — da
 * amministratore di database le policy non si applicano e la misura sarebbe
 * falsa (più veloce di quanto sia davvero).
 *
 * Mostra due varianti: la lettura semplice e quella con il conteggio totale
 * (`page_total`), che è la forma con cui PostgREST risponde quando il client
 * chiede quanti elementi ci sono: nel primo caso il database può fermarsi alle
 * 80 righe che servono, nel secondo deve valutarle tutte.
 *
 *   node scripts/_spiega_registro.mjs [email dell'utente]
 */
import pg from "pg";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const email = process.argv[2] ?? "enricoguarino25@gmail.com";
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const { rows } = await db.query("select id, role from public.profiles where email = $1", [email]);
if (rows.length === 0) {
  console.error(`Nessun profilo con email ${email}`);
  process.exit(1);
}
const utente = rows[0];
console.log(`Utente: ${email} (${utente.role})\n`);

const colonne = "id, at, action, entity_type, entity_id, actor, meta";

async function spiega(titolo, query) {
  console.log(`=== ${titolo} ===`);
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    const claims = JSON.stringify({ sub: utente.id, role: "authenticated" });
    await db.query("set local request.jwt.claims = " + "'" + claims + "'");
    const piano = await db.query(`explain (analyze, buffers) ${query}`);
    for (const riga of piano.rows) console.log("  " + riga["QUERY PLAN"]);
  } finally {
    await db.query("rollback");
  }
  console.log("");
}

await spiega(
  "Lettura semplice (80 righe)",
  `select ${colonne} from public.audit_log order by at desc limit 80`,
);

await spiega(
  "Lettura con il conteggio totale (come richiede la pagina del Registro)",
  `select ${colonne}, count(*) over () as totale from public.audit_log order by at desc limit 80`,
);

await db.end();
