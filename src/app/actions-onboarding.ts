"use server";

import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { inviaEmailGmail, nettizzaDestinatario, validaEmail } from "@/lib/mail";
import { URL_APP, ISTRUZIONI_INSTALLAZIONE } from "@/lib/onboarding-testo";

type Esito = { ok: true } | { ok: false; errore: string };

function errore(msg: string): Esito {
  return { ok: false, errore: msg };
}

function testoOnboarding(link: string): string {
  const piattaforme = ISTRUZIONI_INSTALLAZIONE.map(
    (p) => `${p.titolo.toUpperCase()}\n${p.passi.map((passo, i) => `${i + 1}. ${passo}`).join("\n")}`,
  ).join("\n\n");

  return `Ciao,

ecco il link per accedere al Gestionale ToothTalk (valido 7 giorni):
${link}

Ti conviene installarlo come app sul tuo telefono o computer: si apre più veloce, a schermo intero, senza la barra del browser. Bastano pochi secondi:

${piattaforme}

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

function htmlOnboarding(link: string): string {
  return (
    `<div style="max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;padding:20px;color:#1e293b">` +
    `<p>Ciao,</p>` +
    `<p>Ecco il tuo accesso al Gestionale ToothTalk:</p>` +
    `<a href="${link}" style="display:inline-block;margin-top:8px;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Apri il Gestionale ToothTalk</a>` +
    `<p style="margin-top:24px">Ti conviene installarlo come app sul telefono o computer: si apre più veloce, a schermo intero, senza la barra del browser. Bastano pochi secondi:</p>` +
    ISTRUZIONI_INSTALLAZIONE.map((p) => passiHTML(p.titolo, p.passi)).join("") +
    `<p style="margin-top:24px">Fatto questo, il Gestionale ToothTalk compare come un'app vera e propria, con la sua icona, sul telefono o sul computer.</p>` +
    `<p style="color:#64748b;font-size:.85em;margin-top:32px">Il link è valido 7 giorni. Per qualsiasi problema scrivici pure.<br>— ToothTalk™</p>` +
    `</div>`
  );
}

/**
 * Invia a un indirizzo qualsiasi il link (valido 7 giorni) alla pagina di
 * benvenuto con le istruzioni di installazione come PWA. Solo admin.
 */
export async function inviaLinkOnboarding(destinatarioGrezzo: string): Promise<Esito> {
  const ctx = await requireSession();
  if (!ctx.isAdmin) return errore("Operazione riservata al Coordinatore.");

  const destinatario = nettizzaDestinatario(destinatarioGrezzo);
  if (!validaEmail(destinatario)) return errore("Indirizzo email non valido.");

  const supabase = await supabaseServer();
  const { data: riga, error: eInsert } = await supabase
    .from("inviti_onboarding")
    .insert({ email: destinatario, creato_da: ctx.profile.id })
    .select("token")
    .single<{ token: string }>();
  if (eInsert || !riga) return errore("Creazione del link fallita.");

  const link = `${URL_APP}/benvenuto?token=${riga.token}`;

  const inviata = await inviaEmailGmail({
    destinatario,
    oggetto: "[ToothTalk] Il tuo accesso al Gestionale",
    testo: testoOnboarding(link),
    html: htmlOnboarding(link),
  });
  if (!inviata) return errore("Invio fallito — riprova tra poco.");

  return { ok: true };
}
