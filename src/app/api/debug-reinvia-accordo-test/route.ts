import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { leggiConfigPec } from "@/lib/pec";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Rotta diagnostica TEMPORANEA: reinvia via PEC l'accordo (modello attivo +
 * protocollo operativo) all'account di test "Test Registrazione Enrico" —
 * serve perché quell'account è già approvato (fuori dalla coda "Richieste
 * di registrazione") e non esiste un pulsante di reinvio per un account già
 * approvato. Da rimuovere subito dopo l'uso: non deve restare in produzione.
 */
export async function GET() {
  try {
    const config = leggiConfigPec();
    const admin = supabaseAdmin();

    const { data: modello, error: eModello } = await admin
      .from("modello_accordo")
      .select("storage_path")
      .order("caricato_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ storage_path: string }>();
    if (eModello || !modello) return Response.json({ ok: false, errore: "Nessun modello attivo." });

    const { data: blobModello, error: eBlob } = await admin.storage.from("finali").download(modello.storage_path);
    if (eBlob || !blobModello) return Response.json({ ok: false, errore: "Download modello fallito." });
    const bufferModello = Buffer.from(await blobModello.arrayBuffer());
    const nomeModello = modello.storage_path.split("/").pop() ?? "accordo-editoriale.pdf";

    const protocolloPdf = readFileSync(path.join(process.cwd(), "public", "documenti", "3-protocollo-operativo.pdf"));

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS: config.port !== 465,
      auth: { user: config.user, pass: config.password },
    });

    const info = await transporter.sendMail({
      from: config.mittente,
      to: ["enricoguarino2@gmail.com"],
      cc: config.destinatari.length ? config.destinatari : undefined,
      subject: "[ToothTalk] Benvenuto/a in ToothTalk — un ultimo passo prima di partire",
      text: [
        "",
        "Ciao Test Registrazione Enrico, benvenuto/a in ToothTalk!",
        "",
        "La tua registrazione è stata approvata: da oggi fai parte del progetto,",
        "e non vediamo l'ora di iniziare a lavorare insieme.",
        "",
        "Un solo passaggio prima di partire: in allegato trovi l'accordo",
        "editoriale e il Protocollo Operativo ad esso allegato. Leggili con",
        "calma, firma l'accordo e ricaricalo dal tuo profilo nel gestionale",
        '(sezione "Accordo editoriale").',
        "",
        "[Reinvio manuale di verifica — l'invio originale era fallito per un",
        "blocco IP temporaneo del provider PEC, ora risolto]",
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      attachments: [
        { filename: nomeModello, content: bufferModello, contentType: "application/pdf" },
        { filename: "3-protocollo-operativo.pdf", content: protocolloPdf, contentType: "application/pdf" },
      ],
    });

    return Response.json({ ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (e) {
    return Response.json({ ok: false, errore: e instanceof Error ? e.message : String(e) });
  }
}
