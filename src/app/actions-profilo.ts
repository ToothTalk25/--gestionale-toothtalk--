"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { leggiConfigPec, spedisciPec } from "@/lib/pec";
import { verificaAccordoFirmato, type EsitoVerificaAccordo } from "@/lib/gemini";
import { COOKIE_VERSION, PRIVACY_VERSION, type Profile } from "@/lib/types";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function errore(msg: string): Esito<never> {
  return { ok: false, errore: msg };
}

/** Esegue una promise ignorando gli errori (per le cancellazioni best-effort). */
async function ignora(p: PromiseLike<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    // cancellazione best-effort: se fallisce, non blocca il resto
  }
}

type CampiAnagrafica = Partial<Pick<Profile, "universita" | "pec">>;

/**
 * Elimina l'account e i dati personali "inutili" alla difesa del progetto.
 *
 * Viene eliminato:
 *  - la foto del profilo
 *  - i consensi GDPR e le appartenenze ai gruppi
 *  - il VIDEO GREZZO trasmesso (immagine/voce) dal bucket di lavorazione
 *  - i dati di contatto e anagrafici, e l'accesso (attivo=false)
 *
 * Viene CONSERVATO (tutela legale):
 *  - l'accordo firmato, con la cessione di proprietà del contenuto
 *  - script, copertina e descrizione (già certificati via PEC)
 *  - l'archivio certificato e le copie PEC, immutabili per legge
 */
export async function eliminaAccount(
  userId: string,
  conferma: boolean,
): Promise<Esito<{ account: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!conferma) return errore("Conferma di essere consapevole di cosa stai eliminando.");

  // Solo chi ha accesso globale, o la persona stessa sul proprio account.
  if (!isAdmin && profile.id !== userId) {
    return errore("Operazione non disponibile da qui.");
  }

  const admin = supabaseAdmin();

  // 1. Foto del profilo (l'accordo resta: è il titolo della cessione di proprietà)
  const { data: profilo } = await admin
    .from("profiles")
    .select("id, foto_path, accordo_path")
    .eq("id", userId)
    .single<{ id: string; foto_path: string | null; accordo_path: string | null }>();
  if (profilo?.foto_path) {
    await admin.storage.from("profili").remove([profilo.foto_path]).catch(() => {});
  }

  // 2. Consensi e appartenenze
  await ignora(admin.from("consensi").delete().eq("user_id", userId));
  await ignora(admin.from("memberships").delete().eq("user_id", userId));

  // 3. Solo il VIDEO GREZZO trasmesso (immagine/voce) viene distrutto.
  //    Script, copertina e materiali testuali restano: sono già certificati
  //    via PEC e servono alla difesa del progetto.
  const { data: deliverables } = await admin
    .from("deliverables")
    .select("id, kind")
    .eq("created_by", userId);
  for (const d of deliverables ?? []) {
    if (d.kind !== "video_grezzo") continue;
    const { data: vers } = await admin
      .from("deliverable_versions")
      .select("id, bucket, storage_path")
      .eq("deliverable_id", d.id);
    for (const v of vers ?? []) {
      if (v.bucket === "originali") {
        await ignora(admin.storage.from("originali").remove([v.storage_path]));
        await ignora(admin.from("deliverable_versions").delete().eq("id", v.id));
      }
    }
    await ignora(admin.from("deliverables").delete().eq("id", d.id));
  }

  // 4. Anonimizzazione dei dati personali del profilo. L'accordo resta
  //    (cessione di proprietà); foto e contatti vengono rimossi.
  await admin
    .from("profiles")
    .update({
      email: `ex-${userId.slice(0, 8)}@toothtalk.local`,
      full_name: "Ex partecipante",
      pec: null,
      universita: null,
      foto_path: null,
      attivo: false,
    })
    .eq("id", userId);

  // 5. Rimozione dell'account di accesso (se l'archivio lo consente;
  //    altrimenti resta disattivato: attivo=false impedisce di entrare).
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    // restano i riferimenti all'archivio: profilo anonimizzato + disattivato
  }

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return { ok: true, dati: { account: "ex" } };
}

/** Una task collegata a un partecipante (per il riepilogo della revoca). */
export type TaskRiepilogoRevoca = {
  id: string;
  titolo: string;
  status: string;
  versioni: number;
};

/**
 * Riepilogo delle task con materiali video/audio caricati da un partecipante
 * on-screen (per la modale di conferma della revoca). Solo il Titolare.
 */
export async function riepilogoTaskOnScreen(
  userId: string,
): Promise<Esito<{ task: TaskRiepilogoRevoca[] }>> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");

  const admin = supabaseAdmin();
  const { data: versioni } = await admin
    .from("deliverable_versions")
    .select("id, deliverables!inner(id, task_id, kind)")
    .eq("uploaded_by", userId)
    .eq("origin", "originale")
    .eq("revocato_gdpr", false)
    .in("deliverables.kind", ["video_grezzo", "audio"])
    .returns<
      {
        id: string;
        deliverables: { id: string; task_id: string; kind: string };
      }[]
    >();

  // Raggruppa per task e conta le versioni coinvolte.
  const perTask = new Map<string, number>();
  for (const v of versioni ?? []) {
    const taskId = v.deliverables.task_id;
    perTask.set(taskId, (perTask.get(taskId) ?? 0) + 1);
  }
  const taskIds = [...perTask.keys()];
  if (taskIds.length === 0) return { ok: true, dati: { task: [] } };

  const { data: task } = await admin
    .from("tasks")
    .select("id, titolo, status")
    .in("id", taskIds)
    .order("created_at", { ascending: true })
    .returns<{ id: string; titolo: string; status: string }[]>();

  return {
    ok: true,
    dati: {
      task: (task ?? []).map((t) => ({
        id: t.id,
        titolo: t.titolo,
        status: t.status,
        versioni: perTask.get(t.id) ?? 0,
      })),
    },
  };
}

/**
 * Termina la collaborazione di un partecipante (solo Titolare).
 *
 * ON-SCREEN (Art. 7.3 e 17 GDPR): la revoca del consenso all'uso di
 * immagine/voce è incondizionata. La RPC revoca_video_on_screen marca le
 * consegne originali video/audio dell'interessato (revocato_gdpr=true,
 * transizione one-way ammessa dal trigger append-only) e porta le task a
 * archived_due_to_revocation. I FILE FISICI vengono poi eliminati dallo
 * storage (best-effort); la riga e lo SHA256 restano come prova legale.
 *
 * BACKSTAGE: nessun file toccato — si chiude solo la collaborazione.
 *
 * In entrambi i casi l'account viene disattivato (attivo=false) e l'evento
 * viene registrato nell'audit_log (la catena di hash la gestisce il trigger
 * fn_audit_chain: niente calcoli manuali qui).
 */
export async function terminaCollaborazione(
  userId: string,
  conferma: boolean,
): Promise<Esito<{ on_screen: boolean; task: number; versioni_purgate: number }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");
  if (!conferma) return errore("Conferma esplicita richiesta per terminare la collaborazione.");

  const admin = supabaseAdmin();

  const { data: target } = await admin
    .from("profiles")
    .select("id, on_screen, full_name, attivo")
    .eq("id", userId)
    .single<{ id: string; on_screen: boolean; full_name: string | null; attivo: boolean }>();
  if (!target) return errore("Profilo non trovato.");
  if (!target.attivo) return errore("La collaborazione di questo partecipante è già terminata.");

  let taskIds: string[] = [];
  let versioniPurgate: string[] = [];
  let azione = "chiusura_collaborazione";
  const motivo = `Fine collaborazione con ${target.full_name ?? target.id}`;

  if (target.on_screen) {
    azione = "revoca_on_screen";
    // 1. Marca le versioni e archivia le task nel registro (RPC SECURITY
    //    DEFINER). Si chiama con il client UTENTE (non admin): is_admin()
    //    dentro la RPC legge auth.uid(), che col client service_role
    //    sarebbe null e la revoca verrebbe rifiutata.
    const supabase = await supabaseServer();
    const { data: righe, error: errRpc } = await supabase.rpc("revoca_video_on_screen", {
      p_user: userId,
    });
    if (errRpc) {
      return errore(`Revoca rifiutata dal database: ${errRpc.message}`);
    }
    const righeTipizzate = (righe ?? []) as {
      version_id: string;
      bucket: string;
      storage_path: string;
      task_id: string;
    }[];
    taskIds = [...new Set(righeTipizzate.map((r) => r.task_id))];
    versioniPurgate = righeTipizzate.map((r) => `${r.bucket}/${r.storage_path}`);

    // 2. Elimina i FILE FISICI dallo storage (best-effort: se uno fallisce,
    //    la revoca è comunque registrata; l'eccezione è amministrativa).
    for (const r of righeTipizzate) {
      await ignora(admin.storage.from(r.bucket).remove([r.storage_path]));
    }
  }

  // 3. Disattiva l'account (l'accesso termina in entrambi i casi).
  await admin.from("profiles").update({ attivo: false }).eq("id", userId);

  // 4. UNA riga in audit_log (append-only, hash concatenato dal trigger).
  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: azione,
      entity_type: "profile",
      entity_id: userId,
      meta: {
        motivo,
        task_ids: taskIds,
        versioni_purgate: versioniPurgate,
      },
    }),
  );

  revalidatePath("/admin");
  return {
    ok: true,
    dati: {
      on_screen: target.on_screen,
      task: taskIds.length,
      versioni_purgate: versioniPurgate.length,
    },
  };
}

export async function aggiornaAnagrafica(campi: CampiAnagrafica): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // Il campo "Email o PEC" è facoltativo e accetta qualunque indirizzo
  // valido (anche una normale email). Una PEC vera dà in più la
  // certificazione di consegna, ma non è più richiesta per partecipare.
  if (campi.pec && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campi.pec)) {
    return errore("Inserisci un indirizzo email valido (o lascia vuoto).");
  }

  const { error } = await supabase
    .from("profiles")
    .update(campi)
    .eq("id", profile.id);
  if (error) return errore(error.message);

  revalidatePath("/profilo");
  return { ok: true, dati: undefined };
}

/** Registra la foto del profilo appena caricata. */
export async function caricaFoto(storagePath: string): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  if (!storagePath.startsWith(`${profile.id}/foto/`)) {
    return errore("Percorso del file non valido.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ foto_path: storagePath })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  revalidatePath("/profilo");
  return { ok: true, dati: undefined };
}

/** Registra il consenso GDPR (privacy o cookie) per l'utente corrente. */
export async function registraConsenso(tipo: "privacy" | "cookie" | "riconoscimento_foto"): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const versione = tipo === "privacy" ? PRIVACY_VERSION : COOKIE_VERSION;

  // 1. Registra il consenso nella tabella — è la prova legale, deve sempre
  //    riuscire. Nulla qui sotto deve poter far fallire questa riga.
  const { data: consenso, error } = await supabase.from("consensi").insert({
    user_id: profile.id,
    tipo,
    versione,
  }).select("id").single<{ id: string }>();
  if (error || !consenso) return errore(error?.message ?? "Errore registrazione consenso.");

  // 2. Genera ricevuta HTML firmata (SHA256) — prova dimostrabile per GDPR.
  //    Best-effort: se la generazione, l'upload o la chiave admin falliscono,
  //    il consenso è comunque registrato. Mai errori all'utente.
  try {
    const dataIso = new Date().toISOString();
    const tipoLabel = tipo === "privacy" ? "Informativa Privacy" : tipo === "cookie" ? "Cookie Policy" : "Riconoscimento foto";
    const html =
      `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Ricevuta consenso — ToothTalk</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#1e293b}` +
      `h1{font-size:1.2em}.data{color:#64748b;font-size:.85em;margin-top:2em}</style></head><body>` +
      `<h1>Ricevuta di consenso — ToothTalk</h1>` +
      `<p><strong>Utente:</strong> ${profile.full_name} (${profile.email})</p>` +
      `<p><strong>Consenso:</strong> ${tipoLabel} v${versione}</p>` +
      `<p><strong>Accettato il:</strong> ${dataIso}</p>` +
      `<p><strong>Metodo:</strong> click su interfaccia web autenticata</p>` +
      `<p class="data">Progetto ToothTalk — Documento certificato.</p></body></html>`;

    const buffer = Buffer.from(html, "utf8");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storagePath = `consensi/${profile.id}/${tipo}_v${versione}_${consenso.id}.html`;

    try {
      const admin = supabaseAdmin();
      const { error: eUpload } = await admin.storage.from("finali").upload(storagePath, buffer, {
        contentType: "text/html; charset=utf-8", upsert: false,
      });
      if (eUpload) {
        console.error("Upload ricevuta consenso fallito:", eUpload.message);
      } else {
        await admin.from("consensi").update({ storage_path: storagePath, sha256 }).eq("id", consenso.id);
      }
    } catch (e) {
      console.error("Upload ricevuta consenso THROWS (ignorato):", e);
    }
  } catch (e) {
    console.error("Generazione ricevuta consenso fallita (ignorata):", e);
  }

  revalidatePath("/");
  return { ok: true, dati: undefined };
}

/** Revoca il consenso GDPR (privacy o cookie) per l'utente corrente. Append-only: la revoca viene registrata sulle righe esistenti, mai cancellate. Non tocca le liberatorie già firmate (prova legale). */
export async function revocaConsenso(tipo: "privacy" | "cookie"): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("revoca_consenso", { p_tipo: tipo });
  if (error) return errore(error.message);

  revalidatePath("/");
  revalidatePath("/profilo");
  return { ok: true, dati: undefined };
}

/**
 * Registra l'accordo editoriale caricato e lo spedisce subito via PEC a chi
 * ha accesso globale, con copia al partecipante sulla sua casella. È il
 * meccanismo che costruisce il registro dei partecipanti per sede.
 */
export async function caricaAccordo(
  storagePath: string,
  _sha256Client: string,
  haLettoCompreso: boolean,
): Promise<Esito<{ messageId: string; verifica: EsitoVerificaAccordo }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // Il path deve stare nello spazio di chi chiama: impedisce di far puntare
  // il proprio profilo al file di qualcun altro (che comunque l'RLS dello
  // storage bloccherebbe in lettura, ma qui evitiamo pure di provarci).
  if (!storagePath.startsWith(`${profile.id}/accordo/`)) {
    return errore("Percorso del file non valido.");
  }

  // La spunta "ho letto e compreso" è obbligatoria: non ci si fida del solo
  // controllo lato client (un disabled sul bottone si aggira facilmente),
  // quindi si respinge qui il caricamento se non arriva true.
  if (haLettoCompreso !== true) {
    return errore(
      "Devi confermare di aver letto e compreso l'accordo editoriale prima di caricarlo.",
    );
  }

  // --- PEC all'accesso globale -----------------------------------------
  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(
      e instanceof Error
        ? `La PEC non è configurata: ${e.message}`
        : "La PEC non è configurata.",
    );
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(storagePath);
  if (eBlob || !blob) {
    return errore("File non leggibile dallo storage.");
  }

  const nomeFile = storagePath.split("/").pop() ?? "accordo.pdf";
  const buffer = Buffer.from(await blob.arrayBuffer());
  const nome = profile.full_name ?? profile.email;

  // L'impronta certificata via PEC è quella VERA del file appena scaricato,
  // ricalcolata qui — mai quella dichiarata dal client. Altrimenti chiunque
  // potrebbe far certificare un'impronta diversa dal contenuto reale,
  // svuotando di senso l'intera certificazione.
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_path: storagePath,
      accordo_sha256: sha256,
      accordo_caricato_at: new Date().toISOString(),
      accordo_letto_confermato: true,
    })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  // Registro granulare consents_and_releases (GDPR): accordo collaboratore.
  // L'accordo è UNO SOLO per tutti i collaboratori (on-screen o backstage):
  // la cessione dei diritti di immagine e autore è già dentro l'unico
  // documento. Il flag on_screen resta rilevante solo per la revoca GDPR.
  try {
    await supabaseAdmin().from("consents_and_releases").insert({
      task_id: null,
      user_id: profile.id,
      tipo_soggetto: "collaboratore",
      tipo: "accordo_collaboratore",
      nome_soggetto: nome,
      email_soggetto: profile.email,
      storage_path: storagePath,
      sha256,
      metodo_firma: null,
      firmato_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Registrazione accordo in consents_and_releases fallita (ignorata):", e);
  }

  // --- controllo IA sull'accordo (segnalazione, mai blocco) ------------
  const verifica = await verificaAccordoFirmato({
    pdfBase64: buffer.toString("base64"),
    mimeType: blob.type || "application/pdf",
  });

  const { error: eVerifica } = await supabase
    .from("profiles")
    .update({
      accordo_verificato: verifica.esito,
      accordo_verifica_note: verifica.note || null,
      accordo_verificato_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (eVerifica) {
    return errore(`Accordo salvato ma esito IA non registrato: ${eVerifica.message}`);
  }

  try {
    const { messageId } = await spedisciPec({
      config,
      oggetto: `[ToothTalk] Accordo editoriale — ${nome}`,
      testo: [
        "",
        `Ciao!`,
        "",
        `${nome} ha caricato il proprio accordo editoriale ToothTalk e ha`,
        "dichiarato, spuntando l'apposita casella prima del caricamento, di",
        "aver letto e compreso integralmente il contenuto dell'accordo.",
        "",
        "Il PDF allegato è firmato e viene registrato con data certa: fa parte",
        `del registro dei partecipanti. Università: ${profile.universita ?? "non indicata"}.`,
        "",
        "Impronta SHA-256 del file:",
        `  ${sha256}`,
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Accordo editoriale — ${nome}</h1>
  <p style="font-size:13px;line-height:1.6">
    <strong>${nome}</strong> ha caricato il proprio accordo editoriale ToothTalk e ha
    dichiarato, spuntando l'apposita casella prima del caricamento, di aver letto e
    compreso integralmente il contenuto dell'accordo.
    Il PDF allegato è firmato e viene registrato con data certa: fa parte del
    registro dei partecipanti. Università: ${profile.universita ?? "non indicata"}.
  </p>
  <p style="font-size:12px;color:#666">Impronta SHA-256: <span style="font-family:monospace">${sha256}</span></p>
  <p style="font-size:11px;color:#999">Messaggio generato automaticamente dal gestionale ToothTalk.</p>
</div>`,
      allegati: [
        {
          filename: nomeFile,
          content: buffer,
          contentType: blob.type || "application/pdf",
        },
      ],
      // La copia al partecipante viaggia sulla sua PEC/email se l'ha
      // indicata; altrimenti resta solo la certificazione all'accesso
      // globale. La PEC non è obbligatoria per partecipare.
      copiaConoscenza: profile.pec ? [profile.pec] : undefined,
    });

    revalidatePath("/profilo");
    return { ok: true, dati: { messageId, verifica } };
  } catch (e) {
    return errore(
      `Accordo salvato ma PEC non partita: ${e instanceof Error ? e.message : "errore di spedizione"}`,
    );
  }
  }

/** Genera un URL firmato per scaricare una ricevuta di consenso (admin only). */
/**
 * Carica il MODELLO dell'accordo editoriale (lato admin): il documento
 * che viene inviato ai collaboratori per la firma. Ogni caricamento è una
 * NUOVA riga in modello_accordo (storico append-only in pratica); il
 * modello attivo è l'ultima riga. L'impronta SHA-256 è ricalcolata
 * lato server, mai fidarsi del valore dichiarato dal client.
 */
/**
 * Il Collaboratore comunica la propria volontà di recedere (Art. 8
 * dell'Accordo): registra la richiesta con timestamp immutabile nella
 * tabella richieste_recesso (append-only). Da richiesto_at decorrono i
 * 30 giorni di preavviso — la data certa è quella del gestionale, non
 * quella di un'email.
 */
export async function richiediRecesso(
  motivazione?: string,
): Promise<Esito<{ richiestoAt: string }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("richieste_recesso")
    .insert({
      user_id: profile.id,
      motivazione: motivazione?.trim() ? motivazione.trim() : null,
    })
    .select("richiesto_at")
    .single<{ richiesto_at: string }>();
  if (error) return errore(error.message);

  // Traccia l'evento anche nell'audit log (catena di hash).
  await ignora(
    supabase.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "richiesta_recesso",
      entity_type: "profile",
      entity_id: profile.id,
      meta: {
        motivazione: motivazione?.trim() ? motivazione.trim() : null,
        richiesto_at: data.richiesto_at,
      },
    }),
  );

  revalidatePath("/profilo");
  return { ok: true, dati: { richiestoAt: data.richiesto_at } };
}


export async function caricaModelloAccordo(
  storagePath: string,
): Promise<Esito<{ id: string }>> {
  const { profile } = await requireSession();
  if (profile.role !== "admin") return errore("Solo il Titolare può caricare il modello.");

  const supabase = await supabaseServer();

  if (!storagePath.startsWith("modello-accordo/")) {
    return errore("Percorso del file non valido.");
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("finali")
    .download(storagePath);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { data, error } = await supabase
    .from("modello_accordo")
    .insert({ storage_path: storagePath, sha256, caricato_da: profile.id })
    .select("id")
    .single<{ id: string }>();
  if (error) return errore(error.message);

  revalidatePath("/admin");
  return { ok: true, dati: { id: data.id } };
}

/**
 * L'Admin approva la registrazione di un collaboratore: attiva l'account,
 * conferma/corregge il flag on_screen (serve per la correttezza della
 * revoca GDPR, non per scegliere un accordo — l'accordo è unico per tutti)
 * e invia alla PEC del collaboratore il MODELLO dell'accordo da firmare,
 * con il Titolare in copia. Prima di approvare serve aver caricato il
 * modello (caricaModelloAccordo).
 */
export async function approvaRegistrazione(
  userId: string,
  onScreenConfermato: boolean,
): Promise<Esito<{ messageId: string }>> {
  const { profile: admin } = await requireSession();
  if (admin.role !== "admin") return errore("Solo il Titolare può approvare registrazioni.");

  const supabase = await supabaseServer();

  // Ultimo modello caricato = quello attivo.
  const { data: modello } = await supabase
    .from("modello_accordo")
    .select("storage_path")
    .order("caricato_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ storage_path: string }>();
  if (!modello) {
    return errore("Nessun modello di accordo caricato: caricalo prima di approvare registrazioni.");
  }

  const { data: richiedente } = await supabase
    .from("profiles")
    .select("full_name, email, pec, universita")
    .eq("id", userId)
    .single<{ full_name: string | null; email: string; pec: string | null; universita: string | null }>();
  // La PEC è facoltativa: se assente, l'accordo va all'email di accesso
  // (il canale minimo garantito), senza la certificazione di consegna.
  if (!richiedente?.email) return errore("Questo utente non ha un contatto email valido.");

  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(e instanceof Error ? e.message : "PEC non configurata.");
  }

  const { data: blobModello, error: eBlob } = await supabase.storage
    .from("finali")
    .download(modello.storage_path);
  if (eBlob || !blobModello) return errore("Impossibile leggere il modello dell'accordo.");
  const bufferModello = Buffer.from(await blobModello.arrayBuffer());
  const nomeModello = modello.storage_path.split("/").pop() ?? "accordo-editoriale.pdf";
  const nome = richiedente.full_name ?? richiedente.email;

  const { error: eUpdate } = await supabase
    .from("profiles")
    .update({
      attivo: true,
      on_screen: onScreenConfermato,
      approvato_at: new Date().toISOString(),
      approvato_da: admin.id,
    })
    .eq("id", userId);
  if (eUpdate) return errore(eUpdate.message);

  try {
    const { messageId } = await spedisciPec({
      config,
      oggetto: `[ToothTalk] Registrazione approvata — accordo editoriale da firmare`,
      testo: [
        "",
        `Ciao ${nome}!`,
        "",
        "La tua registrazione a ToothTalk è stata approvata. In allegato trovi",
        "l'accordo editoriale: leggilo con attenzione, firmalo e ricaricalo",
        "firmato dal tuo profilo nel gestionale (sezione \"Accordo editoriale\").",
        "",
        "Al momento del caricamento ti verrà chiesto di confermare di aver",
        "letto e compreso l'accordo: quella conferma, insieme all'accordo",
        "firmato, ti arriverà a sua volta via PEC con data certa.",
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Registrazione approvata</h1>
  <p style="font-size:13px;line-height:1.6">
    Ciao <strong>${nome}</strong>! La tua registrazione a ToothTalk è stata approvata.
    In allegato trovi l'accordo editoriale: leggilo con attenzione, firmalo e
    ricaricalo firmato dal tuo profilo nel gestionale.
  </p>
  <p style="font-size:12px;color:#666">
    Al caricamento ti verrà chiesto di confermare di averlo letto e compreso:
    quella conferma arriverà a sua volta via PEC con data certa.
  </p>
</div>`,
      allegati: [{ filename: nomeModello, content: bufferModello, contentType: "application/pdf" }],
      // "to": la persona — PEC se presente, altrimenti la sua email di
      // accesso (la PEC non è più obbligatoria per partecipare).
      destinatari: [richiedente.pec ?? richiedente.email],
      copiaConoscenza: config.destinatari, // "cc": accesso globale
    });
    revalidatePath("/admin");
    return { ok: true, dati: { messageId } };
  } catch (e) {
    return errore(
      `Account approvato ma PEC non partita: ${e instanceof Error ? e.message : "errore di spedizione"}`,
    );
  }
}


export async function scaricaRicevutaConsenso(consensoId: string): Promise<Esito<string>> {
  const { profile } = await requireSession();
  if (profile.role !== "admin") return errore("Solo l'admin può scaricare le ricevute.");

  const admin = supabaseAdmin();
  const { data: c } = await admin.from("consensi")
    .select("storage_path").eq("id", consensoId).single<{ storage_path: string | null }>();
  if (!c?.storage_path) return errore("Ricevuta non ancora generata.");

  const { data } = await admin.storage.from("finali").createSignedUrl(c.storage_path, 300);
  if (!data?.signedUrl) return errore("Impossibile generare il link.");
  return { ok: true, dati: data.signedUrl };
}

/**
 * Portabilità dei dati personali (GDPR Art. 20): esporta in un unico file
 * JSON tutti i dati dell'utente corrente — profilo, consensi (incluso lo
 * stato di revoca), appartenenze ai poli, e l'elenco dei materiali che ha
 * depositato (senza i file: quelli restano nell'archivio di tutela legale).
 * Il file viene generato al volo e restituito come testo (il browser lo
 * salva). Non tocca né cancella nulla: è una copia per l'interessato.
 */
export async function esportaDatiPersonali(): Promise<Esito<{ nome: string; contenuto: string }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  const [consensi, memberships, poli, materiali] = await Promise.all([
    supabase.from("consensi").select("tipo, versione, accettato_at, revocato_at")
      .eq("user_id", profile.id).order("accettato_at", { ascending: true }),
    supabase.from("memberships").select("polo_id, poli(nome)")
      .eq("user_id", profile.id),
    supabase.from("poli").select("id, nome").order("nome"),
    admin.from("deliverable_versions")
      .select("file_name, mime_type, size_bytes, sha256, uploaded_at, deliverables!inner(kind, task_id)")
      .eq("uploaded_by", profile.id)
      .order("uploaded_at", { ascending: true })
      .returns<{
        file_name: string; mime_type: string | null; size_bytes: number | null;
        sha256: string; uploaded_at: string; deliverables: { kind: string; task_id: string };
      }[]>(),
  ]);

  const nomiPoli = new Map((poli.data ?? []).map((p) => [p.id, p.nome]));
  const pacchetto = {
    generato_il: new Date().toISOString(),
    emittente: "ToothTalk — gestionale interno",
    normativa: "Esportazione ai sensi dell'art. 20 GDPR (diritto alla portabilità)",
    interessato: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      universita: profile.universita,
      ruolo: profile.role,
    },
    consensi: (consensi.data ?? []).map((c) => ({
      tipo: c.tipo, versione: c.versione, accettato_at: c.accettato_at,
      revocato_at: c.revocato_at ?? null,
    })),
    appartenenza_poli: (memberships.data ?? []).map((m) => ({
      polo: nomiPoli.get(m.polo_id) ?? m.polo_id,
    })),
    materiali_depositati: (materiali.data ?? []).map((v) => ({
      kind: v.deliverables.kind,
      file_name: v.file_name,
      mime_type: v.mime_type,
      size_bytes: v.size_bytes,
      sha256: v.sha256,
      upload_at: v.uploaded_at,
    })),
    nota:
      "I file multimediali e i documenti firmati non sono inclusi: fanno parte dell'archivio di tutela legale conservato per il periodo di prescrizione (art. 17(3)(e) GDPR).",
  };

  const nome = `toothtalk-dati-personali-${profile.id.slice(0, 8)}.json`;
  return { ok: true, dati: { nome, contenuto: JSON.stringify(pacchetto, null, 2) } };
}



