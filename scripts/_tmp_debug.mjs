import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync("/Users/enricoguarino5/Gestionale ToothTalk/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await client.connect();

const { rows } = await client.query(
  `select id, titolo, status, locked, polo_id, coinvolge_terzi from tasks where titolo = 'Prova collaudo generale'`,
);
console.table(rows);

const { rows: mem } = await client.query(
  `select m.polo_id, m.user_id, p.full_name from memberships m join profiles p on p.id = m.user_id where p.full_name = 'Mario Rossi'`,
);
console.table(mem);

await client.end();
