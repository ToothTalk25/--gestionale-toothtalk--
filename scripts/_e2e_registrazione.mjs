/**
 * Verifica che la registrazione funzioni ancora dopo l'aggiunta della
 * notifica push: compila il modulo con il codice del gruppo di prova e
 * controlla la schermata di conferma. Poi cancella l'account di prova.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "https://gestionale-toothtalk.vercel.app";
const EMAIL = "prova.notifica.registrazione@toothtalk.local";
const PASSWORD = "ProvaNotificaReg2026!";
const CODICE = process.env.CODICE ?? "PROVA-8G4W";

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { data: residuo } = await db.from("profiles").select("id").eq("email", EMAIL).maybeSingle();
if (residuo) await db.auth.admin.deleteUser(residuo.id);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/registrati?codice=${CODICE}`, { waitUntil: "domcontentloaded" });
await page.locator('input[placeholder="Mario Rossi"]').fill("Prova Notifica");
await page.locator('input[type="email"]').first().fill(EMAIL);
await page.getByRole("button", { name: /dietro le quinte/ }).click();
await page.locator('input[type="password"]').first().fill(PASSWORD);
await page.locator('input[type="checkbox"]').first().check();
await page.getByRole("button", { name: "Crea account" }).click();
await page.waitForTimeout(9000);

const testo = (await page.innerText("body")).replace(/\s+/g, " ");
console.log("richiesta inviata:", testo.includes("è stata inviata") ? "SÌ ✓" : "NO ✗");
console.log("messaggio:", testo.slice(0, 150));
await browser.close();

const { data: creato } = await db.from("profiles").select("id, email, attivo").eq("email", EMAIL).maybeSingle();
console.log("account creato e inattivo (in attesa di approvazione):", creato ? `sì ✓ (attivo=${creato.attivo})` : "NO ✗");
if (creato) {
  await db.auth.admin.deleteUser(creato.id);
  await db.from("inviti_utilizzi").delete().eq("email", EMAIL);
  await db.from("inviti").update({ usi: 0 }).eq("codice", CODICE);
  console.log("account di prova cancellato, codice riportato a 0 usi");
}
