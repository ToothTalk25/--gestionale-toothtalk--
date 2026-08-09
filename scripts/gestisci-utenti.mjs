#!/usr/bin/env node
/**
 * Amministrazione utenti e poli — usa la SERVICE ROLE KEY, quindi bypassa la
 * RLS. Va eseguito solo in locale, mai esposto in rete.
 *
 *   npm run utente -- lista
 *   npm run utente -- crea mario@esempio.it "PasswordProvvisoria1!" "Mario Rossi"
 *   npm run utente -- assegna mario@esempio.it insubria
 *   npm run utente -- rimuovi mario@esempio.it insubria
 *   npm run utente -- promuovi enrico@esempio.it     # -> admin
 *   npm run utente -- password enrico@esempio.it "Nuova1!"   # reimposta la password
 *   npm run utente -- polo "Bologna" bologna Bologna
 */

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const riga of readFileSync(f, "utf8").split("\n")) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const [comando, ...args] = process.argv.slice(2);

const controlla = ({ error }) => {
  if (error) {
    console.error("✗", error.message);
    process.exit(1);
  }
};

async function idUtente(email) {
  const { data, error } = await db.from("profiles").select("id").eq("email", email).single();
  controlla({ error });
  return data.id;
}

async function idPolo(slug) {
  const { data, error } = await db.from("poli").select("id").eq("slug", slug).single();
  controlla({ error });
  return data.id;
}

switch (comando) {
  case "lista": {
    const { data: utenti } = await db
      .from("profiles")
      .select("id, email, full_name, role")
      .order("role");
    const { data: m } = await db.from("memberships").select("user_id, poli(nome)");
    const poliDi = {};
    for (const r of m ?? []) (poliDi[r.user_id] ??= []).push(r.poli.nome);
    for (const u of utenti ?? []) {
      console.log(
        `${u.role.padEnd(6)} ${u.email.padEnd(32)} ${(u.full_name ?? "").padEnd(24)} ${(poliDi[u.id] ?? []).join(", ")}`,
      );
    }
    break;
  }

  case "crea": {
    const [email, password, nome] = args;
    if (!email || !password) {
      console.error("Uso: crea <email> <password> \"<Nome Cognome>\"");
      process.exit(1);
    }
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: nome ?? email.split("@")[0] },
    });
    controlla({ error });
    console.log("✓ utente creato:", data.user.id);
    break;
  }

  case "assegna": {
    const [email, slug] = args;
    const { error } = await db
      .from("memberships")
      .insert({ user_id: await idUtente(email), polo_id: await idPolo(slug) });
    controlla({ error });
    console.log(`✓ ${email} aggiunto al polo ${slug} — stessi permessi degli altri membri`);
    break;
  }

  case "rimuovi": {
    const [email, slug] = args;
    const { error } = await db
      .from("memberships")
      .delete()
      .eq("user_id", await idUtente(email))
      .eq("polo_id", await idPolo(slug));
    controlla({ error });
    console.log(`✓ ${email} rimosso dal polo ${slug}. Le sue consegne restano archiviate.`);
    break;
  }

  case "promuovi": {
    const [email] = args;
    const { error } = await db.from("profiles").update({ role: "admin" }).eq("email", email);
    controlla({ error });
    console.log(`✓ ${email} ha ora accesso globale a tutti i gruppi`);
    break;
  }

  case "password": {
    const [email, password] = args;
    if (!email || !password) {
      console.error("Uso: password <email> <nuovaPassword>");
      process.exit(1);
    }
    const { error } = await db.auth.admin.updateUserById(await idUtente(email), { password });
    controlla({ error });
    console.log(`✓ password di ${email} aggiornata`);
    break;
  }

  case "polo": {
    const [nome, slug, citta] = args;
    const { error } = await db.from("poli").insert({ nome, slug, citta: citta ?? null });
    controlla({ error });
    console.log(`✓ polo ${nome} creato`);
    break;
  }

  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
}
