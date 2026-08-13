/**
 * Invio email da Gmail (tooth.talk25@gmail.com), condiviso fra liberatorie e
 * cron automatici (report, alert). Best-effort: se le credenziali mancano,
 * non lancia ma ritorna false, così i cron non falliscono per un'email.
 */
export async function inviaEmailGmail(opts: {
  destinatario: string;
  oggetto: string;
  testo: string;
}): Promise<boolean> {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.warn("MAIL_USER/MAIL_PASS non configurate: email saltata.");
    return false;
  }
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
      to: opts.destinatario,
      subject: opts.oggetto,
      text: opts.testo,
    });
    return true;
  } catch (e) {
    console.error("Invio email fallito:", e);
    return false;
  }
}
