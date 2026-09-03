/**
 * Invio email da Gmail (tooth.talk25@gmail.com), condiviso fra liberatorie e
 * cron automatici (report, alert). Best-effort: se le credenziali mancano,
 * non lancia ma ritorna false, così i cron non falliscono per un'email.
 *
 * Il destinatario arriva anche da input di utenti non autenticati o campi di
 * modulo (contatto liberatoria): prima dell'invio viene ripulito da
 * ritorni-a-capo e whitespace e deve avere forma di indirizzo email —
 * niente header injection SMTP, niente invii verso destinazioni arbitrarie.
 */

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Ripulisce un destinatario: niente CR/LF (header injection), solo un indirizzo. */
export function nettizzaDestinatario(valore: string): string {
  return valore.replace(/[\r\n]/g, "").trim();
}

/** True solo se l'indirizzo, ripulito, ha forma di email. */
export function validaEmail(valore: string): boolean {
  return RE_EMAIL.test(nettizzaDestinatario(valore));
}

export async function inviaEmailGmail(opts: {
  destinatario: string;
  oggetto: string;
  testo: string;
}): Promise<boolean> {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.warn("MAIL_USER/MAIL_PASS non configurate: email saltata.");
    return false;
  }

  const destinatario = nettizzaDestinatario(opts.destinatario);
  if (!validaEmail(destinatario)) {
    console.warn("Destinatario email non valido, invio saltato:", destinatario);
    return false;
  }
  // L'oggetto viaggia come header: niente ritorni a capo.
  const oggetto = opts.oggetto.replace(/[\r\n]/g, " ").trim();

  try {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
    await t.sendMail({
      from: process.env.MAIL_USER,
      to: destinatario,
      subject: oggetto,
      text: opts.testo,
    });
    return true;
  } catch (e) {
    console.error("Invio email fallito:", e);
    return false;
  }
}
