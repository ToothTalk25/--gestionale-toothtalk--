#!/usr/bin/env node
/**
 * Audit RLS: stato di sicurezza di tabelle e storage in un colpo d'occhio.
 *
 *   npm run audit-rls        oppure      node scripts/audit-rls.mjs
 *
 * Mostra: tabelle public con RLS disattivato o senza policy (default deny),
 * il riepilogo delle policy per tabella, i bucket storage e le policy
 * critiche (profiles, audit_log, consensi, memberships, tasks, inviti).
 * Legge SUPABASE_DB_URL da .env.local. Solo lettura.
 */
import pg from "pg";
import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

console.log("=== Tabelle PUBLIC con RLS DISATTIVATO (potenziale falla) ===");
const r1 = await db.query(
  `select c.relname, c.relrowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
    order by c.relname`,
);
console.log(r1.rows.length === 0 ? "(nessuna — RLS attivo ovunque)" : r1.rows);

console.log("\n=== Tabelle PUBLIC con RLS attivo ma ZERO policy (default deny) ===");
const r2 = await db.query(
  `select c.relname,
          (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policy
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity = true
      and (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) = 0
    order by c.relname`,
);
console.log(r2.rows.length === 0 ? "(nessuna)" : r2.rows.map((r) => r.relname).join(", "));

console.log("\n=== Riepilogo policy per tabella (public) ===");
const r3 = await db.query(
  `select tablename, count(*)::int as n, string_agg(policyname, ', ') as pols
     from pg_policies where schemaname='public' group by tablename order by tablename`,
);
for (const r of r3.rows) console.log(`${r.tablename}: ${r.n} — ${r.pols.slice(0, 180)}`);

console.log("\n=== Bucket storage ===");
const r4 = await db.query(`select id, public from storage.buckets order by id`);
console.log(r4.rows);

console.log("\n=== Policy storage.objects (cmd, roles, qual) ===");
const r5 = await db.query(
  `select p.policyname, p.cmd, p.roles::text,
          left(coalesce(p.qual,''), 160) as qual, left(coalesce(p.with_check,''), 160) as check_ok
     from pg_policies p where p.schemaname='storage' order by p.policyname`,
);
for (const r of r5.rows) {
  console.log(`- ${r.policyname} [${r.cmd}] roles=${r.roles}`);
  if (r.qual) console.log(`    qual: ${r.qual}`);
  if (r.check_ok) console.log(`    with check: ${r.check_ok}`);
}

console.log("\n=== Policy critiche (public) — definizione completa ===");
const r6 = await db.query(
  `select tablename, policyname, cmd, roles::text,
          left(coalesce(qual,''), 300) as qual, left(coalesce(with_check,''), 300) as check_ok
     from pg_policies
    where schemaname='public' and tablename in ('profiles','audit_log','consensi','memberships','tasks','inviti_utilizzi')
    order by tablename, policyname`,
);
for (const r of r6.rows) {
  console.log(`\n${r.tablename}.${r.policyname} [${r.cmd}] roles=${r.roles}`);
  if (r.qual) console.log(`  using: ${r.qual}`);
  if (r.check_ok) console.log(`  check: ${r.check_ok}`);
}

await db.end();

