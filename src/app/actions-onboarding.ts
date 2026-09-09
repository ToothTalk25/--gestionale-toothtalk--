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
  });
  if (!inviata) return errore("Invio fallito — riprova tra poco.");

  return { ok: true };
}
