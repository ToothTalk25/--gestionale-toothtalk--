"use server";

import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { inviaEmailGmail, nettizzaDestinatario, validaEmail } from "@/lib/mail";
import { URL_APP, ISTRUZIONI_INSTALLAZIONE } from "@/lib/onboarding-testo";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function errore(msg: string): Esito<never> {
  return { ok: false, errore: msg };
}

/** Le istruzioni di installazione in testo semplice (email non HTML). */
function piattaformeTesto(): string {
  return ISTRUZIONI_INSTALLAZIONE.map(
    (p) => `${p.titolo.toUpperCase()}\n${p.passi.map((passo, i) => `${i + 1}. ${passo}`).join("\n")}`,
  ).join("\n\n");
}

/**
 * L invito, in un messaggio solo: registrazione (con il codice del gruppo) e
 * istruzioni per installare il Gestionale come app. Sono le due cose che
 * servono alla stessa persona nello stesso momento: prima si registra, poi,
 * approvata, entra e lo installa.
 */
function testoInvito(gruppo: string, codice: string, linkInstallazione: string): string {
  return `Ciao,

per entrare nel Gestionale ToothTalk (gruppo ${gruppo}):

1. Registrati qui: ${URL_APP}/registrati
   Nel campo "Codice del gruppo" scrivi: ${codice}
   (deve comparire "${gruppo}": vuol dire che il codice è giusto)
2. La richiesta viene verificata: appena approvata ricevi per email'accordo
   editoriale da firmare e poi accedi con l'email e la password che hai scelto.

Quando sei dentro, ti conviene installare il Gestionale come app: si apre più
veloce, a schermo intero, senza la barra del browser. Bastano pochi secondi:

${piattaformeTesto()}

Fatto questo, il Gestionale ToothTalk compare come un'app vera e propria, con
la sua icona, sul telefono o sul computer.

Per qualsiasi problema scrivici pure.

— ToothTalk™

(Il link del Gestionale, valido 7 giorni, è questo: ${linkInstallazione})`;
}
function passiHTML(titolo: string, passi: string[]): string {
  return (
    `<p style="margin:24px 0 6px;font-weight:700;font-size:.95em">${titolo}</p>` +
    `<ol style="margin:0;padding-left:20px">${passi.map((p) => `<li style="margin:2px 0">${p}</li>`).join("")}</ol>`
  );
}

function htmlInvito(gruppo: string, codice: string, linkInstallazione: string): string {
  return (
    `<div style="max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;padding:20px;color:#1e293b">` +
    `<p>Ciao,</p>` +
    `<p>Ecco come entrare nel Gestionale ToothTalk, gruppo <strong>${gruppo}</strong>.</p>` +
    `<p style="margin:24px 0 6px;font-weight:700;font-size:.95em">1 · Registrati</p>` +
    `<p>Apri <a href="${URL_APP}/registrati">${URL_APP}/registrati</a> e nel campo "Codice del gruppo" scrivi:</p>` +
    `<p style="font-family:ui-monospace,monospace;font-size:1.2em;font-weight:700;letter-spacing:.5px">${codice}</p>` +
    `<p style="font-size:.9em;color:#64748b">Appena lo inserisci deve comparire "${gruppo}": vuol dire che il codice è giusto.</p>` +
    `<p style="margin:24px 0 6px;font-weight:700;font-size:.95em">2 · Attendi l'approvazione</p>` +
    `<p>La richiesta viene verificata: appena approvata ricevi l'accordo editoriale da firmare e poi accedi con l'email e la password che hai scelto.</p>` +
    `<p style="margin:24px 0 6px;font-weight:700;font-size:.95em">3 · Installalo come app</p>` +
    ISTRUZIONI_INSTALLAZIONE.map((p) => passiHTML(p.titolo, p.passi)).join("") +
    `<p style="color:#64748b;font-size:.85em;margin-top:28px">Il link del Gestionale è valido 7 giorni: <a href="${linkInstallazione}">apri il Gestionale</a>.<br>— ToothTalk™</p>` +
    `</div>`
  );
}
/**
 * Invita una persona in un gruppo: prende (o crea) il codice di ingresso del
 * gruppo e manda UNA email con link di registrazione, codice e istruzioni per
 * installare il Gestionale come app.
 *
 * Prima esistevano due sezioni separate, "genera il codice" e "invia il link":
 * chi riceveva solo il link si trovava davanti al login senza poter entrare,
 * perché il codice era l anello che mancava. Ora partono insieme.
 */
export async function inviaInvitoGruppo(
  destinatarioGrezzo: string,
  poloId: string,
  opzioni?: { maxUsi?: number | null; scadeIl?: string | null },
): Promise<Esito<{ gruppo: string; codice: string }>> {
  const ctx = await requireSession();
  if (!ctx.isAdmin) return errore("Operazione riservata a chi ha accesso globale.");

  const destinatario = nettizzaDestinatario(destinatarioGrezzo);
  if (!validaEmail(destinatario)) return errore("Indirizzo email non valido.");

  const supabase = await supabaseServer();

  const { data: polo } = await supabase
    .from("poli")
    .select("id, nome")
    .eq("id", poloId)
    .maybeSingle<{ id: string; nome: string }>();
  if (!polo) return errore("Gruppo non trovato.");

  // Il codice vivo del gruppo, se c'è: si riusa. Rigenerarlo a ogni invio
  // invaliderebbe quello già mandato agli altri.
  const { data: vivo } = await supabase
    .from("inviti")
    .select("codice")
    .eq("polo_id", polo.id)
    .eq("attivo", true)
    .order("creato_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ codice: string }>();

  let codice = vivo?.codice ?? null;
  if (!codice) {
    const { data, error } = await supabase.rpc("crea_invito", {
      p_polo: polo.id,
      p_max_usi: opzioni?.maxUsi ?? null,
      p_scade_il: opzioni?.scadeIl ?? null,
    });
    if (error || !data) return errore("Creazione del codice non riuscita.");
    codice = data as string;
  }

  // Link del Gestionale (valido 7 giorni): serve a installarlo come app.
  const { data: riga, error: eInsert } = await supabase
    .from("inviti_onboarding")
    .insert({ email: destinatario, creato_da: ctx.profile.id })
    .select("token")
    .single<{ token: string }>();
  if (eInsert || !riga) return errore("Creazione del link non riuscita.");

  const linkInstallazione = `${URL_APP}/benvenuto?token=${riga.token}`;

  const inviata = await inviaEmailGmail({
    destinatario,
    oggetto: `[ToothTalk] Invito a entrare nel gruppo ${polo.nome}`,
    testo: testoInvito(polo.nome, codice, linkInstallazione),
    html: htmlInvito(polo.nome, codice, linkInstallazione),
  });
  if (!inviata) return errore("Invio non riuscito — riprova tra poco.");

  return { ok: true, dati: { gruppo: polo.nome, codice } };
}
