/**
 * Controllo di salute post-aggiornamento: un accesso VERO dal browser con un
 * account reale (Mario, accordo completo) — deve arrivare alla dashboard e la
 * dashboard deve caricarsi.
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = "mario.rossi.messina@esempio.it";
const PASSWORD = env.MARIO_PASSWORD ?? "MarioRossi.Messina2026!";

const browser = await chromium.launch();
const page = await browser.newPage();
const errori = [];
page.on("pageerror", (e) => errori.push(e.message.slice(0, 120)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.locator('input[type="email"]').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole("button", { name: "Accedi" }).click();

let uscito = false;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(2000);
  if (!new URL(page.url()).pathname.startsWith("/login")) {
    uscito = true;
    break;
  }
}
const dove = page.url().replace(BASE, "");
const testo = (await page.innerText("body")).replace(/\s+/g, " ");
console.log("accesso riuscito:", uscito ? "SÌ ✓" : "NO ✗");
console.log("atterra su:", dove);
console.log("pagina caricata:", testo.slice(0, 140));
console.log("voci di menu visibili:", ["Progetti", "Risorse"].filter((v) => testo.includes(v)).join(", ") || "nessuna");

// giro di pagine chiave senza ricaricare a mano (navigazione interna)
for (const percorso of ["/dashboard", "/risorse", "/documenti", "/profilo"]) {
  await page.goto(`${BASE}${percorso}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const t = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 60);
  console.log(`  ${percorso.padEnd(12)} -> ${page.url().replace(BASE, "").padEnd(12)} | ${t}`);
}
console.log("errori JavaScript:", errori.length ? errori.join(" | ") : "nessuno");
await browser.close();
