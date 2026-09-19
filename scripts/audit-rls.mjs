#!/usr/bin/env node
/**
 * Audit RLS: stato di sicurezza di tabelle e storage in un colpo d'occhio.
 *
 *   npm run audit-rls        oppure      node scripts/audit-rls.mjs
 *
 * Mostra: tabelle public con RLS disattivato o senza policy (default deny),
 * il riepilogo delle policy per tabella, i bucket storage e le policy
 * critiche (profiles, audit_log, consensi, memberships, tasks, inviti).
 *
 * Dalla migrazione al piano Pro mostra anche lo SPAZIO usato (storage per
 * bucket e dimensione del database), le chiavi esterne senza indice e le
 * estensioni utili disponibili ma non attive: sono i tre numeri che dicono se
 * c'è qualcosa da cambiare ora che i limiti del piano gratuito non
 * costringono più.
 *
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

console.log("\n=== Spazio usato (storage per bucket, database) ===");
const r7 = await db.query(
  `select bucket_id, count(*)::int as oggetti,
          pg_size_pretty(sum(coalesce((metadata->>'size')::bigint, 0))) as occupato
     from storage.objects group by 1
    order by sum(coalesce((metadata->>'size')::bigint, 0)) desc nulls last`,
);
if (r7.rows.length === 0) console.log("(nessun oggetto)");
for (const r of r7.rows) console.log(`${r.bucket_id}: ${r.oggetti} oggetti, ${r.occupato}`);
const r8 = await db.query(`select pg_size_pretty(pg_database_size(current_database())) as db`);
console.log(`database: ${r8.rows[0].db}`);

// Le chiavi esterne senza indice sono un'informazione di prestazione, non di
// sicurezza: a queste dimensioni (database di pochi MB) non si sentono. Si
// guardano quando una tabella cresce molto o una query diventa lenta.
console.log("\n=== Chiavi esterne senza indice ===");
const r9 = await db.query(
  `select c.conrelid::regclass as tabella, a.attname as colonna
     from pg_constraint c
     join unnest(c.conkey) as k(attnum) on true
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and k.attnum = any(i.indkey))
    order by 1, 2`,
);
console.log(
  r9.rows.length === 0
    ? "(nessuna)"
    : `${r9.rows.length}: ` + r9.rows.map((r) => `${r.tabella}.${r.colonna}`).join(", "),
);

console.log("\n=== Estensioni utili disponibili ma non attive ===");
const r10 = await db.query(
  `select name from pg_available_extensions
    where name in ('pg_cron', 'pgaudit')
      and not exists (select 1 from pg_extension e where e.extname = name)
    order by 1`,
);
console.log(r10.rows.length === 0 ? "(nessuna)" : r10.rows.map((r) => r.name).join(", "));

// ------------------------------------------------------------- PRESTAZIONI
// Misure, non opinioni: dove il database spende tempo davvero, e quante
// espressioni di policy vengono valutate riga per riga. Sono i due numeri che
// dicono cosa ottimizzare e — rilanciando lo stesso comando dopo un intervento
// — quanto si è guadagnato. Le query del controllo stesso sono escluse.
console.log("\n=== Prestazioni: le query più pesanti (pg_stat_statements) ===");
const { rows: ext } = await db.query(
  `select 1 from pg_extension where extname = 'pg_stat_statements'`,
);
if (ext.length === 0) {
  console.log("(pg_stat_statements non attiva — dashboard Supabase → Database → Extensions)");
} else {
  const r11 = await db.query(
    `select left(regexp_replace(query, '\\s+', ' ', 'g'), 66) as query, calls,
            round(total_exec_time::numeric, 1) as totale_ms,
            round(mean_exec_time::numeric, 2) as media_ms
       from pg_stat_statements
      where query not ilike '%pg_stat_statements%'
        and query not ilike '%pg_timezone%'
      order by total_exec_time desc limit 8`,
  );
  for (const r of r11.rows) {
    console.log(
      `${String(r.calls).padStart(7)} volte · ${String(r.media_ms).padStart(8)} ms di media · ${String(r.totale_ms).padStart(8)} ms in totale\n          ${r.query}`,
    );
  }
}

console.log("\n=== Prestazioni: tabelle lette con scansione sequenziale ===");
const r12 = await db.query(
  `select relname as tabella, n_live_tup as righe, seq_scan as scansioni_seq, idx_scan as letture_indice
     from pg_stat_user_tables
    where n_live_tup > 0 and seq_scan > 0
    order by seq_tup_read desc nulls last limit 8`,
);
for (const r of r12.rows) {
  console.log(
    `${r.tabella}: ${r.righe} righe · ${r.scansioni_seq} scansioni sequenziali · ${r.letture_indice} per indice`,
  );
}

// Le policy con auth.uid() o con una funzione SENZA argomenti vengono
// rivalutate per ogni riga: spostarle dentro (select …) le fa valutare una
// volta sola. È il motivo per cui la lettura del Registro costava 20 ms su 272
// righe (corretto in 0141). Qui si contano SOLO quelle rimaste fuori dalla
// forma a valutazione singola: dopo `select auth.uid()` la chiamata c'è ancora,
// quindi cercarla e basta darebbe sempre lo stesso numero.
console.log("\n=== Prestazioni: policy ancora valutate riga per riga ===");
const r13 = await db.query(
  `select x.tabella, count(*)::int as policy
     from (
       select c.relname as tabella,
              (
                (coalesce(u.e, '') like '%auth.uid()%'
                  and coalesce(u.e, '') !~* '\\([[:space:]]*select[[:space:]]+auth\\.uid\\(\\)')
                or (coalesce(u.e, '') like '%is_admin()%'
                  and coalesce(u.e, '') !~* '\\([[:space:]]*select[[:space:]]+(public\\.)?is_admin\\(\\)')
                or (coalesce(u.e, '') like '%accesso_progetti()%'
                  and coalesce(u.e, '') !~* '\\([[:space:]]*select[[:space:]]+(public\\.)?accesso_progetti\\(\\)')
              ) as per_riga
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
         cross join lateral (
           select coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
                  coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as e
         ) u
        where n.nspname in ('public', 'storage')
     ) x
    where x.per_riga
    group by 1 order by 2 desc, 1`,
);
if (r13.rows.length === 0) {
  console.log("(nessuna: tutte a valutazione singola)");
}
for (const r of r13.rows) console.log(`${r.tabella}: ${r.policy} policy ancora per riga`);

// Più policy PERMISSIVE per lo stesso comando si sommano in OR: ognuna viene
// valutata per ogni riga. Fonderle in una sola espressione dà lo stesso
// risultato con un eventuale ottavo del lavoro (storage.objects ne ha 8 di
// lettura, 6 di inserimento, 5 di cancellazione).
console.log("\n=== Prestazioni: policy permissive multiple per comando ===");
const r14 = await db.query(
  `select c.relname as tabella, p.polcmd as comando, count(*)::int as quante
     from pg_policy p join pg_class c on c.oid = p.polrelid
    where p.polpermissive
    group by 1, 2 having count(*) > 1
    order by 3 desc, 1 limit 8`,
);
const nomeComando = { r: "lettura", a: "inserimento", w: "modifica", d: "cancellazione", "*": "tutto" };
for (const r of r14.rows) {
  console.log(`${r.tabella} [${nomeComando[r.comando] ?? r.comando}]: ${r.quante} policy in OR`);
}

await db.end();

