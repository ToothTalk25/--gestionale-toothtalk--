import pg from "pg";
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const TASK = "af3cc717-eb03-43f0-bf50-3feb3022e3e1";

// dati reali di riferimento
const { rows: membro } = await db.query(`select id from profiles where email = 'test@toothtalk.local'`);
const { rows: admin } = await db.query(`select id from profiles where role = 'admin' and attivo limit 1`);
const { rows: pkg } = await db.query(
  `select id from pacchetti_video where task_id = $1 and stato <> 'annullato' order by created_at desc limit 1`, [TASK]);
const { rows: vers } = await db.query(
  `select v.id, v.storage_path from deliverable_versions v
   join deliverables d on d.id = v.deliverable_id
   where d.task_id = $1 and v.bucket = 'originali'`, [TASK]);
console.log("membro:", membro[0]?.id, "| admin:", admin[0]?.id, "| pacchetto:", pkg[0]?.id);
console.log("versioni dichiarazione:", vers.length);
for (const v of vers) console.log("  -", v.id, v.storage_path);
if (!membro[0] || !pkg[0] || !vers[0]) { console.log("dati di riferimento mancanti"); process.exit(0); }

const membroId = membro[0].id;
const adminId = admin[0].id;
const pkgId = pkg[0].id;
const vId = vers[0].id;
const path = vers[0].storage_path;

async function come(uid, label) {
  await db.query("begin");
  await db.query(`set local role authenticated`);
  await db.query(`set local request.jwt.claims = '{"sub": "${uid}", "role": "authenticated"}'`);
  const r = {};
  r.versione = (await db.query(`select count(*)::int as n from deliverable_versions where id = $1`, [vId])).rows[0].n;
  r.storage = (await db.query(`select count(*)::int as n from storage.objects where bucket_id = 'originali' and name = $1`, [path])).rows[0].n;
  const rpc = await db.query(`select ruolo, file_name, size_bytes is not null as ha_size, sha256 is not null as ha_sha from pacchetto_elementi_meta($1)`, [pkgId]);
  r.meta = rpc.rows;
  const colonne = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='deliverable_versions' and column_name in ('storage_path','sha256')`);
  // Prova anche che il membro NON possa leggere storage_path delle versioni (difesa in profondità)
  r.leggibile_path = (await db.query(`select count(*)::int as n from deliverable_versions where id = $1 and storage_path = $2`, [vId, path])).rows[0].n;
  await db.query("rollback");
  console.log(`\n--- ${label} ---`);
  console.log("  riga deliverable_versions visibile:", r.versione, "(atteso 0 per membro, 1 per admin)");
  console.log("  oggetto storage visibile:", r.storage, "(atteso 0 per membro, 1 per admin)");
  console.log("  pacchetto_elementi_meta:", r.meta.length ? r.meta.map((m) => `${m.ruolo} (${m.file_name})`).join(", ") : "(vuoto)");
}

await come(membroId, "MEMBRO (test@toothtalk.local)");
await come(adminId, "ADMIN");
await db.end();
