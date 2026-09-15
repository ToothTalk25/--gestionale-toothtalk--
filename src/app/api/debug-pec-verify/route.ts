import nodemailer from "nodemailer";
import { leggiConfigPec } from "@/lib/pec";

/**
 * Rotta diagnostica TEMPORANEA: verifica solo la connessione SMTP alla PEC
 * (nessun invio) per controllare se il blocco Aruba per sospetto abuso è
 * ancora attivo sull'IP in uscita di Vercel. Da rimuovere subito dopo l'uso:
 * non deve restare in produzione.
 */
export async function GET() {
  try {
    const config = leggiConfigPec();
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: { user: config.user, pass: config.password },
    });
    await transporter.verify();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, errore: e instanceof Error ? e.message : String(e) });
  }
}
