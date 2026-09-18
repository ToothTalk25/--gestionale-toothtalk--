#!/usr/bin/env node
/**
 * invia-pec.mjs — spedisce le PEC in coda dal computer.
 *
 * Perché non lo fa la piattaforma: dal 15 settembre 2026 Aruba blocca gli
 * invii automatici della casella toothtalk@pec.it quando arrivano da indirizzi
 * esteri e da troppi indirizzi diversi —
 *
 *   554 5.7.1 Indirizzo IP bloccato temporaneamente per sospetto abuso
 *
 * È esattamente il caso di Vercel, che non ha regioni italiane e cambia
 * indirizzo a ogni invio. Nel ticket 19039798A Aruba ha scritto che gli IP
 * italiani, anche dinamici, NON vengono bloccati, e che per gli IP esteri
 * l'unico rimedio è aprire la casella a tutti gli indirizzi — cioè rinunciare
 * alla protezione anti-abuso su una casella che firma documenti con valore
 * legale. Da qui in poi la PEC parte da questo computer.
 *
 * Lo stato resta nel database (tabella pec_da_inviare, migrazione 0139):
 * stessa architettura della copia su Google Drive (scripts/esporta-drive.mjs).
 *
 *   node scripts/invia-pec.mjs               cosa spedirebbe (nessuna spedizione)
 *   node scripts/invia-pec.mjs --verifica    controlla configurazione, casella e coda
 *   node scripts/invia-pec.mjs --esegui      spedisce davvero
 *   node scripts/invia-pec.mjs --id <uuid>   una sola riga (anche in errore, per riprovare)
 *
 * Le righe in 'errore' NON ripartono da sole con --esegui: un errore va letto
 * prima (un file cambiato dopo l'accodamento, un destinatario sbagliato),
 * altrimenti si ripeterebbe identico a ogni giro. Si riprovano una per una,
 * con --id.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// --------------------------------------------------------------- .env.local
const env = {};
try {
  for (const riga of readFileSync(".env.local", "utf8").split("\n")) {
    const m = riga.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    env[m[1]] = v;
  }
} catch {
  console.error("Manca .env.local: esegui lo script dalla cartella del progetto.");
  process.exit(1);
}

const ESEGUI = process.argv.includes("--esegui");
const VERIFICA = process.argv.includes("--verifica");
const iId = process.argv.indexOf("--id");
const SOLO_ID = iId >= 0 ? process.argv[iId + 1] : null;

const CONFIG = {
  host: env.PEC_HOST,
  port: Number(env.PEC_PORT || 465),
  user: env.PEC_USER,
  password: env.PEC_PASSWORD,
  mittente: env.PEC_MITTENTE || env.PEC_USER,
  // Tetto del gestore per l'intero messaggio (Aruba/Poste: di norma 100 MB).
  maxByte: Number(env.PEC_MAX_MESSAGGIO_MB || 100) * 1024 * 1024,
};

const mancanti = ["PEC_HOST", "PEC_USER", "PEC_PASSWORD"].filter((k) => !env[k]);
if (mancanti.length) {
  console.error("Configurazione PEC incompleta in .env.local: manca " + mancanti.join(", "));
  process.exit(1);
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const impronta = (buf) => createHash("sha256").update(buf).digest("hex");
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Da dove stiamo uscendo su internet: è la prova che serve ad Aruba.
 * Tre servizi in cascata (alcuni rispondono "occupato" e va bene così):
 * il primo che risponde dà indirizzo e paese; l'ultimo almeno l'indirizzo.
 * Se non risponde nessuno si va avanti lo stesso — l'IP non decide l'invio.
 */
async function ipPubblico() {
  const tentativi = [
    async () => {
      const j = await (await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(5000) })).json();
      return j.ip ? `${j.ip} (${j.country_code ?? "paese ignoto"}${j.org ? ", " + j.org : ""})` : null;
    },
    async () => {
      const j = await (await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(5000) })).json();
      return j.ip ? `${j.ip} (${j.country ?? "paese ignoto"}${j.org ? ", " + j.org : ""})` : null;
    },
    async () => {
      const j = await (await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) })).json();
      return j.ip ? `${j.ip} (paese non rilevato)` : null;
    },
  ];

  for (const tenta of tentativi) {
    try {
      const esito = await tenta();
      if (esito) return esito;
    } catch {
      // si prova il prossimo
    }
  }
  return null;
}

/** Destinatari utilizzabili: niente ritorni a capo (header injection), uno per indirizzo. */
function separaDestinatari(valore) {
  const tutti = (valore ?? []).map((v) => String(v).replace(/[\r\n]/g, "").trim()).filter(Boolean);
  return { validi: tutti.filter((v) => RE_EMAIL.test(v)), scartati: tutti.filter((v) => !RE_EMAIL.test(v)) };
}

/**
 * Trasforma i riferimenti della coda nei file veri, verificando ogni impronta.
 * Se un file non corrisponde all'impronta registrata al momento
 * dell'accodamento NON si spedisce: meglio nessuna data certa che certificare
 * un file diverso da quello che si è deciso di certificare.
 */
async function risolviAllegati(allegati) {
  const fuori = [];
  let totale = 0;

  for (const a of allegati ?? []) {
    let contenuto;
    if (typeof a.testo === "string") {
      contenuto = Buffer.from(a.testo, "utf8");
    } else if (a.file_pubblico) {
      try {
        contenuto = readFileSync(join(process.cwd(), "public", "documenti", a.file_pubblico));
      } catch {
        throw new Error(`allegato "${a.nome}": documento del progetto non leggibile (${a.file_pubblico})`);
      }
    } else {
      const { data, error } = await db.storage.from(a.bucket).download(a.percorso);
      if (error || !data) {
        throw new Error(
          `allegato "${a.nome}": file non scaricabile da ${a.bucket}/${a.percorso} (${error?.message ?? "assente"})`,
        );
      }
      contenuto = Buffer.from(await data.arrayBuffer());
    }

    if (a.sha256) {
      const trovata = impronta(contenuto);
      if (trovata !== a.sha256) {
        throw new Error(
          `allegato "${a.nome}": l'impronta NON corrisponde a quella registrata in coda ` +
            `(attesa ${String(a.sha256).slice(0, 16)}…, trovata ${trovata.slice(0, 16)}…): ` +
            "il file è cambiato dopo l'accodamento. La spedizione è ferma: verifica il file e " +
            "rimetti la PEC in coda da capo.",
        );
      }
    }

    totale += contenuto.byteLength;
    fuori.push({ filename: a.nome, content: contenuto });
  }

  const budget = Math.floor(CONFIG.maxByte * 0.7);
  if (totale > budget) {
    throw new Error(
      `allegati troppo pesanti: ${Math.round(totale / 1024 / 1024)} MB, il massimo è ` +
        `${Math.round(budget / 1024 / 1024)} MB (il gestore si ferma a ${Math.round(CONFIG.maxByte / 1024 / 1024)} MB)`,
    );
  }
  return fuori;
}

const trasportatore = nodemailer.createTransport({
  host: CONFIG.host,
  port: CONFIG.port,
  secure: CONFIG.port === 465,
  // Su 25/587 la connessione parte in chiaro e si alza a TLS con STARTTLS:
  // per una PEC il canale deve essere cifrato per forza.
  requireTLS: CONFIG.port !== 465,
  auth: { user: CONFIG.user, pass: CONFIG.password },
});

// ---------------------------------------------------------------- --verifica
if (VERIFICA) {
  console.log("casella:   ", CONFIG.user, "via", CONFIG.host + ":" + CONFIG.port);
  console.log("mittente:  ", CONFIG.mittente);

  const ip = await ipPubblico();
  console.log("IP pubblico:", ip ?? "(non rilevato)");
  const paese = ip?.match(/\(([A-Z]{2})[,)]/)?.[1] ?? null;
  if (paese && paese !== "IT") {
    console.log(
      `             ATTENZIONE: l'uscita risulta in ${paese}, non in Italia — Aruba può bloccarla (ticket 19039798A).`,
    );
  }

  try {
    await trasportatore.verify();
    console.log("casella:    accesso riuscito (utente e password validi)");
  } catch (e) {
    console.log("casella:    ACCESSO NON RIUSCITO —", e.message);
  }

  const { data: tutte } = await db.from("pec_da_inviare").select("stato");
  const conta = (s) => (tutte ?? []).filter((r) => r.stato === s).length;
  console.log("\ncoda:      ", conta("in_coda"), "da spedire,", conta("errore"), "in errore,", conta("inviata"), "spedite");

  const { data: ultima } = await db
    .from("pec_da_inviare")
    .select("oggetto, inviata_at, message_id")
    .eq("stato", "inviata")
    .order("inviata_at", { ascending: false })
    .limit(1);
  if (ultima?.[0]) {
    console.log("ultimo invio:", new Date(ultima[0].inviata_at).toLocaleString("it-IT"), "—", ultima[0].oggetto);
  }
  process.exit(0);
}

// -------------------------------------------------------------------- coda
let lettura = db.from("pec_da_inviare").select("*").order("creato_at", { ascending: true });
lettura = SOLO_ID ? lettura.eq("id", SOLO_ID) : lettura.eq("stato", "in_coda");
const { data: righe, error } = await lettura;
if (error) {
  console.error("Lettura della coda non riuscita:", error.message);
  process.exit(1);
}

if (!righe.length) {
  console.log("Coda vuota: nessuna PEC da spedire.");
  // In simulazione vale la pena vedere anche quello che è fermo: sono messaggi
  // che non hanno ancora data certa e che non ripartono da soli.
  const { data: fermi } = await db
    .from("pec_da_inviare")
    .select("id, oggetto, ultimo_errore, creato_at")
    .eq("stato", "errore")
    .order("creato_at", { ascending: true });
  if (fermi?.length) {
    console.log(`\nCi sono ${fermi.length} PEC ferme in errore (NON ripartono da sole):`);
    for (const f of fermi) {
      console.log(`  ${f.id}  ${f.oggetto}`);
      console.log(`      ${new Date(f.creato_at).toLocaleString("it-IT")} — ${f.ultimo_errore ?? "(nessun motivo registrato)"}`);
    }
    console.log("\nPer riprovarne una: node scripts/invia-pec.mjs --esegui --id <id>");
  }
  process.exit(0);
}

const ip = await ipPubblico();
console.log(
  `PEC in coda: ${righe.length}${ESEGUI ? " — spedizione reale" : " — simulazione (aggiungi --esegui per spedire)"}`,
);
console.log(`Uscita su internet: ${ip ?? "(non rilevato)"}\n`);

let spedite = 0;
let problemi = 0;

/** Registra l'errore sulla riga: la PEC resta ferma, con il motivo scritto accanto. */
async function segnaErrore(id, messaggio) {
  const { data } = await db.from("pec_da_inviare").select("tentativi").eq("id", id).single();
  await db.from("pec_da_inviare").update({
    stato: "errore",
    tentativi: (data?.tentativi ?? 0) + 1,
    ultimo_errore: messaggio.slice(0, 500),
    aggiornato_at: new Date().toISOString(),
  }).eq("id", id);
}

/**
 * Le cose che l'applicazione non può fare quando mette in coda la PEC, perché
 * non sa ancora se partirà: qui diventano vere. Un loro fallimento NON rende la
 * PEC "non spedita" (è partita davvero e non va rispedita): la riga resta
 * "inviata" con una nota, perché il resto vada sistemato a mano.
 */
async function applicaContesto(riga, messageId, destinatari) {
  const c = riga.contesto ?? {};
  try {
    if (c.tipo === "ricertificazione" && c.profile_id) {
      await db.from("profiles").update({ accordo_pec_fallita_at: null }).eq("id", c.profile_id);
    } else if (c.tipo === "verbale" && c.pacchetto_id) {
      // È questo che porta il pacchetto a 'pec_inviata' e fa partire la copia su Drive.
      const { error } = await db.rpc("registra_esito_pec", {
        p_pacchetto: c.pacchetto_id,
        p_stato: "pec_inviata",
        p_message_id: messageId,
        p_destinatari: destinatari,
        p_errore: null,
        p_note: c.note ?? null,
      });
      if (error) throw new Error(error.message);
    }
    return null;
  } catch (e) {
    return `lo stato collegato non è stato aggiornato (${String(e?.message ?? e)}): da sistemare a mano`;
  }
}


for (const riga of righe) {
  console.log(`— ${riga.oggetto}`);
  console.log(`  preparata: ${new Date(riga.creato_at).toLocaleString("it-IT")}`);

  const to = separaDestinatari(riga.destinatari);
  const cc = separaDestinatari(riga.copia_conoscenza ?? []).validi.filter((v) => !to.validi.includes(v));
  console.log(`  a:  ${to.validi.join(", ") || "(nessuno)"}`);
  if (cc.length) console.log(`  cc: ${cc.join(", ")}`);
  if (to.scartati.length) console.log(`  scartati (indirizzo non valido): ${to.scartati.join(", ")}`);
  for (const a of riga.allegati ?? []) console.log(`  allegato: ${a.nome}`);

  if (!to.validi.length) {
    console.log("  ESITO: nessun destinatario valido — non spedita.\n");
    if (ESEGUI) await segnaErrore(riga.id, "Nessun destinatario valido nella riga di coda.");
    problemi++;
    continue;
  }

  if (!ESEGUI) {
    // In simulazione i file si scaricano comunque, per controllare le impronte:
    // è il pre-volo, quello che evita di scoprire il problema a spedizione avviata.
    try {
      const allegati = await risolviAllegati(riga.allegati);
      const mb = (allegati.reduce((s, a) => s + a.content.byteLength, 0) / 1024 / 1024).toFixed(2);
      console.log(`  allegati: ${allegati.length} (${mb} MB) — le impronte corrispondono`);
    } catch (e) {
      console.log(`  ATTENZIONE: ${e.message}`);
      problemi++;
    }
    console.log("  (simulazione: nulla è stato spedito)\n");
    continue;
  }

  try {
    const allegati = await risolviAllegati(riga.allegati);
    const info = await trasportatore.sendMail({
      from: CONFIG.mittente,
      to: to.validi,
      cc: cc.length ? cc : undefined,
      subject: String(riga.oggetto).replace(/[\r\n]/g, " ").trim(),
      text: riga.testo,
      html: riga.html ?? undefined,
      attachments: allegati,
    });

    // Prima si registra che è partita, poi si sistema il resto: se il giro
    // successivo la vedesse ancora "in coda", la rispedirebbe una seconda volta.
    await db.from("pec_da_inviare").update({
      stato: "inviata",
      message_id: info.messageId,
      inviata_at: new Date().toISOString(),
      ultimo_errore: null,
      aggiornato_at: new Date().toISOString(),
    }).eq("id", riga.id);

    // Traccia nella catena di audit (0074): il computer spedisce senza sessione,
    // quindi l'attore è nullo — quello che conta è che la riga esista.
    await db.from("audit_log").insert({
      actor: null,
      actor_role: null,
      action: "pec_inviata_dal_computer",
      entity_type: "pec_da_inviare",
      entity_id: riga.id,
      meta: {
        oggetto: riga.oggetto,
        message_id: info.messageId,
        destinatari: to.validi,
        allegati: (riga.allegati ?? []).map((a) => a.nome),
      },
    });

    const nota = await applicaContesto(riga, info.messageId, to.validi);
    if (nota) {
      console.log(`  ESITO: spedita (${info.messageId}) — ma ${nota}`);
      await db.from("pec_da_inviare").update({ ultimo_errore: nota, aggiornato_at: new Date().toISOString() }).eq("id", riga.id);
    } else {
      console.log(`  ESITO: spedita (${info.messageId})`);
    }
    spedite++;
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.log(`  ESITO: NON spedita — ${msg}`);
    await segnaErrore(riga.id, msg);
    problemi++;
  }
  console.log("");
}

console.log(
  ESEGUI
    ? `Spedizione conclusa: ${spedite} spedite, ${problemi} non spedite.`
    : `Simulazione conclusa: ${righe.length} da spedire, ${problemi} con problemi. Nessuna spedizione.`,
);
if (ESEGUI && problemi) process.exitCode = 1;

