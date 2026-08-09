import "server-only";
import nodemailer from "nodemailer";
import type { ElementoManifesto, ManifestoPacchetto } from "@/lib/types";

/**
 * Spedizione del verbale via PEC.
 *
 * Cosa dà davvero la PEC: DATA CERTA e integrità del messaggio. Il gestore
 * genera una ricevuta di accettazione e una di avvenuta consegna, entrambe
 * firmate, che attestano che quel contenuto esisteva in quel momento.
 *
 * Cosa NON può fare: trasportare un video da 2 GB. I gestori italiani si
 * fermano fra i 30 e i 100 MB per messaggio. Per questo il verbale certifica
 * le IMPRONTE SHA-256: l'impronta identifica il file in modo univoco, quindi
 * la PEC dà data certa al contenuto del video senza doverlo allegare. Gli
 * elementi leggeri (copertina, descrizione, script, manifesto) viaggiano
 * comunque come allegati, in chiaro.
 */

export type ConfigPec = {
  host: string;
  port: number;
  user: string;
  password: string;
  mittente: string;
  destinatari: string[];
  /** Tetto del gestore per l'intero messaggio (Poste: di norma 100 MB). */
  maxMessaggioByte: number;
};

/**
 * Quanti byte di file "veri" stanno in un messaggio.
 *
 * Gli allegati viaggiano codificati in base64, che li gonfia di un terzo
 * (3 byte diventano 4). A questo si aggiungono intestazioni e corpo del
 * messaggio. Il 70% del tetto è il margine prudente: su 100 MB di limite
 * restano circa 70 MB di file effettivi.
 */
export function budgetAllegati(config: ConfigPec): number {
  return Math.floor(config.maxMessaggioByte * 0.7);
}

export function leggiConfigPec(): ConfigPec {
  const mancanti = ["PEC_HOST", "PEC_USER", "PEC_PASSWORD", "PEC_DESTINATARI"].filter(
    (k) => !process.env[k],
  );
  if (mancanti.length) {
    throw new Error(`Configurazione PEC incompleta: manca ${mancanti.join(", ")}`);
  }

  return {
    host: process.env.PEC_HOST!,
    port: Number(process.env.PEC_PORT ?? 465),
    user: process.env.PEC_USER!,
    password: process.env.PEC_PASSWORD!,
    mittente: process.env.PEC_MITTENTE ?? process.env.PEC_USER!,
    destinatari: process.env
      .PEC_DESTINATARI!.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    maxMessaggioByte:
      Number(process.env.PEC_MAX_MESSAGGIO_MB ?? 100) * 1024 * 1024,
  };
}

const etichetta: Record<string, string> = {
  video: "Video montato",
  copertina: "Copertina",
  descrizione: "Descrizione da pubblicare",
  script: "Script usato per il video",
};

function esc(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

export function oggettoVerbale(m: ManifestoPacchetto) {
  const corto = m.manifest_hash?.slice(0, 12) ?? "";
  return `[ToothTalk] ${m.polo.nome} · ${m.task.titolo} — deposito certificato ${corto}`;
}

export function corpoTesto(m: ManifestoPacchetto, allegati: string[]): string {
  const righe: string[] = [
    "",
    "Ciao!",
    "",
    `Questo messaggio certifica il deposito di un video realizzato dal gruppo`,
    `${m.polo.nome}${m.polo.citta ? " (" + m.polo.citta + ")" : ""} per il progetto ToothTalk.`,
    "",
    "Il pacchetto è stato completato, rivisto e sigillato: da questo momento",
    "la PEC gli dà data certa. I file elencati qui sotto esistevano esattamente",
    "così in questa data, con queste impronte — ed è la tutela di chi ha creato",
    "il video.",
    "",
    "Se domani qualcuno sostenesse che il contenuto era diverso, basterebbe",
    "ricalcolare l'impronta SHA-256 del file e confrontarla con quella riportata",
    "qui: se combaciano, la prova è fatta.",
    "",
    "────────────────────────────────────────",
    "",
    `Gruppo:              ${m.polo.nome}${m.polo.citta ? " (" + m.polo.citta + ")" : ""}`,
    `Progetto:            ${m.task.titolo}`,
    `Sigillato il:        ${m.sigillato_at}`,
    `Sigillato da:        ${m.sigillato_da.nome ?? ""} <${m.sigillato_da.email}>`,
    `Impronta manifesto:  ${m.manifest_hash ?? "—"}`,
    "",
    "ELEMENTI CERTIFICATI",
    "",
  ];

  for (const e of m.elementi) {
    righe.push(`--- ${etichetta[e.ruolo] ?? e.ruolo} ---`);
    if (e.tipo === "file") {
      righe.push(`file    : ${e.file_name}`);
      righe.push(`byte    : ${e.size_bytes ?? "—"}`);
      righe.push(`sha256  : ${e.sha256}`);
      righe.push(`caricato: ${e.caricato_at} da ${e.caricato_da}`);
    } else {
      righe.push(`sha256  : ${e.sha256}  (${e.caratteri} caratteri, UTF-8)`);
      righe.push("");
      righe.push(e.testo);
    }
    righe.push("");
  }

  righe.push(
    "────────────────────────────────────────",
    "",
    "Non devi fare niente adesso: chi ha realizzato il video conserva la",
    "propria copia. Se un giorno servisse verificare un file, ti basta",
    "ricalcolarne l'impronta:",
    "",
    "  macOS / Linux:  shasum -a 256 nomefile",
    "  Windows:        certutil -hashfile nomefile SHA256",
    "",
    "Deve coincidere con il valore riportato sopra.",
    "",
    "Grazie per far parte di ToothTalk — questo messaggio è la vostra garanzia.",
    "",
    ...(allegati.length
      ? [
          `Allegati: ${allegati.join(", ")}.`,
          "I file troppo pesanti per la PEC non sono allegati: la loro impronta",
          "SHA-256, riportata sopra, li identifica comunque con la stessa data certa.",
        ]
      : [
          "Allegati: nessuno.",
        ]),
    "",
    "Messaggio generato automaticamente dal gestionale ToothTalk.",
  );

  return righe.join("\n");
}

export function corpoHtml(m: ManifestoPacchetto, allegati: string[]): string {
  const blocchi = m.elementi
    .map((e: ElementoManifesto) => {
      const testa = `<h3 style="margin:18px 0 4px;font:600 14px system-ui;color:#0d1b2a">${esc(
        etichetta[e.ruolo] ?? e.ruolo,
      )}</h3>`;

      if (e.tipo === "file") {
        return `${testa}
<table style="font:13px system-ui;border-collapse:collapse">
<tr><td style="color:#666;padding-right:12px">File</td><td>${esc(e.file_name)}</td></tr>
<tr><td style="color:#666;padding-right:12px">Dimensione</td><td>${e.size_bytes ?? "—"} byte</td></tr>
<tr><td style="color:#666;padding-right:12px">SHA-256</td><td style="font-family:monospace">${esc(e.sha256)}</td></tr>
<tr><td style="color:#666;padding-right:12px">Caricato</td><td>${esc(e.caricato_at)} da ${esc(e.caricato_da)}</td></tr>
</table>`;
      }

      return `${testa}
<p style="font:13px system-ui;color:#666;margin:0 0 6px">SHA-256 <span style="font-family:monospace">${esc(
        e.sha256,
      )}</span> — ${e.caratteri} caratteri (UTF-8)</p>
<pre style="font:13px/1.5 system-ui;white-space:pre-wrap;background:#f6f7f9;padding:12px;border-radius:8px;margin:0">${esc(
        e.testo,
      )}</pre>`;
    })
    .join("\n");

  return `<div style="max-width:720px;font:14px/1.6 system-ui;color:#0d1b2a">
<p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk</p>
<h1 style="font-size:20px;margin:4px 0 12px">Deposito certificato · ${esc(m.polo.nome)}</h1>

<div style="background:#f0f5ff;border-radius:12px;padding:16px;margin-top:16px;font-size:13px;line-height:1.6;color:#0d1b2a">
  <p style="margin:0"><strong>Ciao!</strong></p>
  <p style="margin:8px 0 0">
    Questo messaggio certifica il deposito di un video realizzato dal gruppo
    <strong>${esc(m.polo.nome)}${m.polo.citta ? " (" + esc(m.polo.citta) + ")" : ""}</strong>
    per il progetto ToothTalk.
  </p>
  <p style="margin:8px 0 0">
    Il pacchetto è stato completato, rivisto e sigillato: da questo momento
    la PEC gli dà <strong>data certa</strong>. I file elencati qui sotto esistevano
    esattamente così in questa data, con queste impronte — ed è la tutela di
    chi ha creato il video.
  </p>
  <p style="margin:8px 0 0;font-size:12px;color:#555">
    Se domani qualcuno sostenesse che il contenuto era diverso, basterebbe
    ricalcolare l'impronta SHA-256 del file e confrontarla con quella riportata
    qui: se combaciano, la prova è fatta.
  </p>
</div>

<table style="font:13px system-ui;border-collapse:collapse;margin:20px 0 0">
<tr><td style="color:#666;padding-right:16px">Gruppo</td><td>${esc(m.polo.nome)}${
    m.polo.citta ? ` (${esc(m.polo.citta)})` : ""
  }</td></tr>
<tr><td style="color:#666;padding-right:16px">Progetto</td><td>${esc(m.task.titolo)}</td></tr>
<tr><td style="color:#666;padding-right:16px">Sigillato il</td><td>${esc(m.sigillato_at)}</td></tr>
<tr><td style="color:#666;padding-right:16px">Sigillato da</td><td>${esc(
    m.sigillato_da.nome ?? "",
  )} &lt;${esc(m.sigillato_da.email)}&gt;</td></tr>
<tr><td style="color:#666;padding-right:16px">Impronta manifesto</td><td style="font-family:monospace">${esc(
    m.manifest_hash ?? "—",
  )}</td></tr>
</table>

${blocchi}

<div style="background:#f6f7f9;border-radius:12px;padding:16px;margin-top:24px;font-size:12px;line-height:1.6;color:#555">
  <p style="margin:0">
    <strong>Non devi fare niente adesso:</strong> chi ha realizzato il video
    conserva la propria copia. Se un giorno servisse verificare un file:
  </p>
  <p style="margin:6px 0 0;font-family:monospace;font-size:11px">
    macOS / Linux:&nbsp;&nbsp;shasum -a 256 nomefile<br>
    Windows:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;certutil -hashfile nomefile SHA256
  </p>
  <p style="margin:6px 0 0">
    L'impronta deve coincidere con il valore riportato sopra.
  </p>
</div>

<p style="font-size:12px;color:#666;margin-top:24px">
  Allegati: ${allegati.length ? esc(allegati.join(", ")) : "nessuno"}.
  I file troppo pesanti per la PEC non sono allegati: la loro impronta
  SHA-256, riportata sopra, li identifica comunque con la stessa data certa.
</p>

<p style="font-size:13px;color:#0d1b2a;margin-top:20px;font-weight:500">
  Grazie per far parte di ToothTalk — questo messaggio è la vostra garanzia.
</p>

<p style="font-size:11px;color:#999;margin-top:12px">
  Messaggio generato automaticamente dal gestionale ToothTalk.
</p>
</div>`;
}

export type Allegato = { filename: string; content: Buffer; contentType?: string };

export async function spedisciPec(opts: {
  config: ConfigPec;
  oggetto: string;
  testo: string;
  html: string;
  allegati: Allegato[];
  copiaConoscenza?: string[];
}): Promise<{ messageId: string; accettato: string[] }> {
  const { config } = opts;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    // Su 25/587 la connessione parte in chiaro e si alza a TLS con STARTTLS:
    // per una PEC il canale deve essere cifrato per forza.
    requireTLS: config.port !== 465,
    auth: { user: config.user, pass: config.password },
  });

  const info = await transporter.sendMail({
    from: config.mittente,
    to: config.destinatari,
    // Chi partecipa al gruppo riceve la stessa copia sulla casella ordinaria:
    // così la prova non sta solo in un'unica cassetta.
    cc: opts.copiaConoscenza?.length ? opts.copiaConoscenza : undefined,
    subject: opts.oggetto,
    text: opts.testo,
    html: opts.html,
    attachments: opts.allegati,
  });

  return {
    messageId: info.messageId,
    accettato: (info.accepted ?? []).map(String),
  };
}
