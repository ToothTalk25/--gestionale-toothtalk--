#!/usr/bin/env node
/**
 * Esegue le migrazioni SQL in ordine sul database Supabase.
 *
 *   npm run migra           applica tutte le migrazioni
 *   npm run migra -- 0006   applica solo i file che iniziano per "0006"
 *
 * Legge la stringa di connessione da SUPABASE_DB_URL in .env.local.
 * Ogni file viene eseguito con una connessione propria: è il motivo per cui
 * 0005 (che aggiunge valori a un enum) e 0006 (che li usa) non si pestano i
 * piedi — Postgres non permette di usare un valore di enum nella stessa
 * transazione in cui è stato aggiunto.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const radice = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const f of [".env.local", ".env"]) {
  const p = join(radice, f);
  if (!existsSync(p)) continue;
  for (const riga of readFileSync(p, "utf8").split("\n")) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "\nManca SUPABASE_DB_URL in .env.local.\n" +
      "Prendila dal dashboard Supabase: pulsante Connect in alto → ORMs/URI →\n" +
      "copia la stringa che inizia con postgresql:// e incollala nel file.\n",
  );
  process.exit(1);
}

const filtro = process.argv[2];
const cartella = join(radice, "supabase", "migrations");
const file = readdirSync(cartella)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !filtro || f.startsWith(filtro))
  .sort();

if (!file.length) {
  console.error(`Nessuna migrazione trovata${filtro ? ` per "${filtro}"` : ""}.`);
  process.exit(1);
}

console.log(`\nDatabase: ${url.replace(/:[^:@]+@/, ":****@")}\n`);

for (const nome of file) {
  const sql = readFileSync(join(cartella, nome), "utf8");
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  process.stdout.write(`  ${nome} … `);
  try {
    await client.connect();
    await client.query(sql);
    console.log("ok");
  } catch (e) {
    console.log("ERRORE");
    console.error(`\n${e.message}\n`);
    if (e.position) {
      const riga = sql.slice(0, Number(e.position)).split("\n").length;
      console.error(`  intorno alla riga ${riga} di ${nome}\n`);
    }
    await client.end().catch(() => {});
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

console.log("\nTutte le migrazioni applicate.\n");
