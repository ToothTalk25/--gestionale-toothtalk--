import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { inviaPushAdmin } from "@/lib/push";
import type { ElementoManifesto, ManifestoPacchetto } from "@/lib/types";

/**
 * La PEC: che cosa dà, che cosa non può fare, e da dove parte.
 *
 * Cosa dà davvero: DATA CERTA e integrità del messaggio. Il gestore genera una
 * ricevuta di accettazione e una di avvenuta consegna, entrambe firmate, che
 * attestano che quel contenuto esisteva in quel momento.
 *
 * Cosa NON può fare: trasportare un video da 2 GB. I gestori italiani si
 * fermano fra i 30 e i 100 MB per messaggio. Per questo il verbale certifica
 * le IMPRONTE SHA-256: l'impronta identifica il file in modo univoco, quindi
 * la PEC dà data certa al contenuto del video senza doverlo allegare. Gli
 * elementi leggeri (copertina, descrizione, script, manifesto) viaggiano
 * comunque come allegati, in chiaro.
 *
 * Da dove parte, dal 0139: NON da qui. Aruba blocca gli invii automatici che
 * arrivano da indirizzi esteri e da troppi indirizzi diversi (Vercel non ha
 * regioni italiane), e l'unico rimedio che offre è togliere la protezione
 * anti-abuso dalla casella. Quindi questa applicazione non spedisce più:
 * ACCODA (accodaPec), e a spedire è `npm run pec -- --esegui`, eseguito su una
 * postazione italiana. Della configurazione le serve ormai solo il tetto del
 * messaggio: le credenziali della casella non le servono, e non le ha.
 */

/**
 * Quanti byte di file "veri" stanno in un messaggio PEC.
 *
 * Gli allegati viaggiano codificati in base64, che li gonfia di un terzo
 * (3 byte diventano 4). A questo si aggiungono intestazioni e corpo del
 * messaggio. Il 70% del tetto è il margine prudente: su 100 MB di limite
 * restano circa 70 MB di file effettivi.
 */
export function budgetAllegatiPec(): number {
  const tetto = Number(process.env.PEC_MAX_MESSAGGIO_MB ?? 100) * 1024 * 1024;
  return Math.floor(tetto * 0.7);
}

const etichetta: Record<string, string> = {
  video: "Video montato",
  copertina: "Copertina",
  descrizione: "Descrizione da pubblicare",
  script: "Script usato per il video",
  titolo_youtube: "Titolo per YouTube Shorts",
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
<p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk™</p>
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

// =====================================================================
// La coda (0139): il gestionale prepara, il computer spedisce
// =====================================================================

/**
 * Destinatari PEC dell'accesso globale (PEC_DESTINATARI), senza chiedere
 * host, utente e password: dopo 0139 l'applicazione non spedisce più da sé,
 * quindi le credenziali della casella non le servono — le ha solo la
 * postazione che esegue lo script. Chiedere qui user/password significherebbe
 * tenerle su Vercel senza che nessuno le usi.
 */
export function destinatariPecGlobali(): string[] {
  const valore = process.env.PEC_DESTINATARI;
  if (!valore) throw new Error("Configurazione PEC incompleta: manca PEC_DESTINATARI.");
  return valore
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Un allegato in coda, come riferimento (i byte non entrano nel database).
 *
 * Le tre forme coprono i tre casi reali: un file nello storage, un documento
 * del progetto servito da `public/documenti/`, un allegato generato al volo
 * (il manifesto del pacchetto, le note in chiaro). Per le prime due l'impronta
 * è OBBLIGATORIA: è la garanzia che a essere certificato sia il file deciso
 * quando si è messo in coda il messaggio, non quello che c'è al momento della
 * spedizione (i documenti del progetto possono essere aggiornati nel frattempo).
 */
export type AllegatoCoda =
  | { nome: string; bucket: string; percorso: string; sha256: string }
  | { nome: string; file_pubblico: string; sha256: string }
  | { nome: string; testo: string };

/**
 * Lo stato che l'applicazione non può aggiornare al momento dell'invio, perché
 * l'invio non è più suo. `tipo` è il campo che lo script legge.
 */
export type ContestoPec =
  | { tipo: "deposito"; profile_id: string }
  | { tipo: "ricertificazione"; profile_id: string }
  | { tipo: "verbale"; pacchetto_id: string; note?: string | null };

/**
 * Mette una PEC in coda per la spedizione dal computer.
 *
 * Non spedisce niente e non restituisce un message_id: restituisce l'id della
 * riga di coda. Chi chiama NON deve raccontare che il documento è partito —
 * deve dire che è in coda (e la sezione "PEC da spedire" del Registro mostra
 * cosa aspetta).
 *
 * Lancia se la coda non accetta la riga: è l'unico modo perché chi chiama
 * possa mettere in atto il proprio ripiego, invece di credere che il messaggio
 * sia al sicuro.
 */
export async function accodaPec(opts: {
  oggetto: string;
  testo: string;
  html?: string;
  /** "to": se assente, l'accesso globale (i destinatari di PEC_DESTINATARI). */
  destinatari?: string[];
  /** "cc": chi partecipa al gruppo, o l'accesso globale quando il "to" è una persona. */
  copiaConoscenza?: string[];
  allegati?: AllegatoCoda[];
  contesto?: ContestoPec;
  /**
   * Avvisa l'accesso globale sul telefono appena la PEC entra in coda (default:
   * sì). Si spegne solo per i messaggi che non chiedono niente — per esempio
   * l'avviso "controfirma confermata", che è già una notizia per chi lo legge
   * nella casella PEC.
   */
  avvisa?: boolean;
}): Promise<{ id: string }> {
  const destinatari = opts.destinatari?.length ? opts.destinatari : destinatariPecGlobali();

  const { data, error } = await supabaseAdmin()
    .from("pec_da_inviare")
    .insert({
      oggetto: opts.oggetto,
      testo: opts.testo,
      html: opts.html ?? null,
      destinatari,
      copia_conoscenza: opts.copiaConoscenza?.length ? opts.copiaConoscenza : null,
      allegati: opts.allegati ?? [],
      contesto: opts.contesto ?? {},
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`PEC non entrata in coda: ${error?.message ?? "nessuna riga creata"}`);
  }

  // Promemoria immediato: una PEC in coda è un documento che non ha ancora data
  // certa, e la coda non si svuota da sola — va eseguito un comando sul computer
  // del progetto. Meglio saperlo subito che scoprirlo dal controllo notturno.
  // Best-effort: la coda è già registrata, una notifica mancata non cambia nulla.
  if (opts.avvisa !== false) {
    await inviaPushAdmin({
      title: "PEC da spedire",
      body: opts.oggetto.length > 90 ? `${opts.oggetto.slice(0, 87)}…` : opts.oggetto,
      url: "/admin",
    });
  }

  return { id: data.id };
}
