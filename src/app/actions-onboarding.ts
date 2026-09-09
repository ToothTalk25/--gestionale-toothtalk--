"use server";

import { requireSession } from "@/lib/auth";
import { inviaEmailGmail, nettizzaDestinatario, validaEmail } from "@/lib/mail";

type Esito = { ok: true } | { ok: false; errore: string };

function errore(msg: string): Esito {
  return { ok: false, errore: msg };
}

const URL_APP = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

function testoOnboarding(): string {
  return `Ciao,

ecco il link per accedere al Gestionale ToothTalk:
${URL_APP}

Ti conviene installarlo come app sul tuo telefono o computer: si apre più veloce, a schermo intero, senza la barra del browser. Bastano pochi secondi:

IPHONE (in Safari — non funziona da altri browser)
1. Apri il link sopra
2. Tocca l'icona di condivisione (il quadrato con la freccia verso l'alto, in basso al centro)
3. Scorri e tocca "Aggiungi a Home"
4. Conferma con "Aggiungi" in alto a destra

ANDROID (in Chrome)
1. Apri il link sopra
2. Tocca i tre puntini in alto a destra
3. Tocca "Installa app" (oppure "Aggiungi a schermata Home")
4. Conferma

MAC
- Chrome o Edge: apri il link, clicca l'icona di installazione nella barra degli indirizzi (a destra, un monitor con una freccia), poi "Installa"
- Safari: apri il link, dal menu File scegli "Aggiungi al Dock"

WINDOWS (Chrome o Edge)
1. Apri il link sopra
2. Clicca l'icona di installazione nella barra degli indirizzi (o, su Edge, i tre puntini in alto → "App" → "Installa questo sito come app")
3. Conferma

Fatto questo, il Gestionale ToothTalk compare come un'app vera e propria, con la sua icona, sul telefono o sul computer.

Per qualsiasi problema scrivici pure.

— ToothTalk™`;
}

/** Un blocco di istruzioni per una piattaforma: titolo + passi numerati. */
function passiHTML(titolo: string, passi: string[]): string {
  return (
    `<p style="margin:24px 0 6px;font-weight:700;font-size:.95em">${titolo}</p>` +
    `<ol style="margin:0;padding-left:20px">${passi.map((p) => `<li style="margin:2px 0">${p}</li>`).join("")}</ol>`
  );
}

function htmlOnboarding(): string {
  return (
    `<div style="max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;padding:20px;color:#1e293b">` +
    `<p>Ciao,</p>` +
    `<p>Ecco il tuo accesso al Gestionale ToothTalk:</p>` +
    `<a href="${URL_APP}" style="display:inline-block;margin-top:8px;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Apri il Gestionale ToothTalk</a>` +
    `<p style="margin-top:24px">Ti conviene installarlo come app sul telefono o computer: si apre più veloce, a schermo intero, senza la barra del browser. Bastano pochi secondi:</p>` +
    passiHTML("IPHONE (in Safari — non funziona da altri browser)", [
      "Apri il link sopra",
      "Tocca l'icona di condivisione (il quadrato con la freccia verso l'alto, in basso al centro)",
      `Scorri e tocca "Aggiungi a Home"`,
      `Conferma con "Aggiungi" in alto a destra`,
    ]) +
    passiHTML("ANDROID (in Chrome)", [
      "Apri il link sopra",
      "Tocca i tre puntini in alto a destra",
      `Tocca "Installa app" (oppure "Aggiungi a schermata Home")`,
      "Conferma",
    ]) +
    passiHTML("MAC", [
      `Chrome o Edge: apri il link, clicca l'icona di installazione nella barra degli indirizzi (a destra, un monitor con una freccia), poi "Installa"`,
      `Safari: apri il link, dal menu File scegli "Aggiungi al Dock"`,
    ]) +
    passiHTML("WINDOWS (Chrome o Edge)", [
      "Apri il link sopra",
      `Clicca l'icona di installazione nella barra degli indirizzi (o, su Edge, i tre puntini in alto → "App" → "Installa questo sito come app")`,
      "Conferma",
    ]) +
    `<p style="margin-top:24px">Fatto questo, il Gestionale ToothTalk compare come un'app vera e propria, con la sua icona, sul telefono o sul computer.</p>` +
    `<p style="color:#64748b;font-size:.85em;margin-top:32px">Per qualsiasi problema scrivici pure.<br>— ToothTalk™</p>` +
    `</div>`
  );
}

/** Invia a un indirizzo qualsiasi il link del gestionale + istruzioni di installazione come PWA. Solo admin. */
export async function inviaLinkOnboarding(destinatarioGrezzo: string): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Coordinatore.");

  const destinatario = nettizzaDestinatario(destinatarioGrezzo);
  if (!validaEmail(destinatario)) return errore("Indirizzo email non valido.");

  const inviata = await inviaEmailGmail({
    destinatario,
    oggetto: "[ToothTalk] Il tuo accesso al Gestionale",
    testo: testoOnboarding(),
    html: htmlOnboarding(),
  });
  if (!inviata) return errore("Invio fallito — riprova tra poco.");

  return { ok: true };
}
