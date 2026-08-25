"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { normalizzaConDiff, messaggioDiff } from "@/lib/formato";
import { salvaPacchettoSchema } from "@/lib/schemi";
import { traduciErroreDb } from "@/lib/erroriDb";
import {
  budgetAllegati,
  corpoHtml,
  corpoTesto,
  leggiConfigPec,
  oggettoVerbale,
  spedisciPec,
  type Allegato,
} from "@/lib/pec";
import type { ManifestoPacchetto, PacchettoVideoRow, RuoloElemento } from "@/lib/types";

export type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function errore(msg: string): Esito<never> {
  return { ok: false, errore: msg };
}

/** Esegue una promise ignorando gli errori (per le operazioni best-effort). */
async function ignora(p: PromiseLike<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    // best-effort: se fallisce, non blocca il resto
  }
}

// -------------------------------------------------------- composizione

/** Crea la bozza del pacchetto se non esiste, o ne aggiorna i testi. */
export async function salvaPacchetto(
  taskId: string,
  campi: { descrizione?: string; script?: string; titolo_youtube?: string },
): Promise<Esito<{ pacchettoId: string; avvisi: string[] }>> {
  // Validazione Zod: il payload dal client viene controllato prima di tutto.
  const validazione = salvaPacchettoSchema.safeParse({ taskId, campi });
  if (!validazione.success) {
    return errore(validazione.error.issues[0]?.message ?? "Dati non validi.");
  }
  ({ taskId } = validazione.data);
  ({ campi } = validazione.data);

  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // Regole di forma uniformi sui testi pubblicabili.
  const avvisi: string[] = [];
  const normalizzati: typeof campi = {};
  if (campi.descrizione !== undefined) {
    const { valore, diff } = normalizzaConDiff("descrizione", campi.descrizione);
    normalizzati.descrizione = valore ?? "";
    if (diff) avvisi.push(messaggioDiff(diff));
  }
  if (campi.script !== undefined) {
    const { valore, diff } = normalizzaConDiff("script", campi.script);
    normalizzati.script = valore ?? "";
    if (diff) avvisi.push(messaggioDiff(diff));
  }
  if (campi.titolo_youtube !== undefined) {
    const { valore, diff } = normalizzaConDiff("titolo_youtube", campi.titolo_youtube);
    normalizzati.titolo_youtube = valore ?? "";
    if (diff) avvisi.push(messaggioDiff(diff));
  }

  const { data: esistente } = await supabase
    .from("pacchetti_video")
    .select("id, stato")
    .eq("task_id", taskId)
    .neq("stato", "annullato")
    .maybeSingle();

  if (!esistente) {
    const { data, error } = await supabase
      .from("pacchetti_video")
      .insert({ task_id: taskId, ...normalizzati, created_by: profile.id })
      .select("id")
      .single();
    if (error) return errore(error.message);
    revalidatePath(`/task/${taskId}`);
    return { ok: true, dati: { pacchettoId: data.id, avvisi } };
  }

  if (esistente.stato !== "bozza") {
    return errore("Il pacchetto è già sigillato: i testi non sono più modificabili.");
  }

  const { error } = await supabase
    .from("pacchetti_video")
    .update(normalizzati)
    .eq("id", esistente.id);
  if (error) return errore(error.message);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: { pacchettoId: esistente.id, avvisi } };
}

/**
 * Aggancia al pacchetto il video di dichiarazione appena caricato nello
 * slot dedicato 7 del "Video completo" (kind video_grezzo, bucket
 * originali): crea l'elemento con ruolo 'dichiarazione_identita' — non
 * copia il file, resta un riferimento alla stessa riga di
 * deliverable_versions. Il caricamento vero avviene nello slot (via
 * UploadDeliverable -> registraVersione); questa funzione lo collega subito
 * dopo, come fa oggi PacchettoVideo chiamando direttamente collegaElemento.
 * La visibilità del file è riservata al solo Titolare (migrazione 0109):
 * chi ha caricato vede solo i metadati dello slot e può segnalare un errore.
 */
export async function collegaDichiarazioneIdentita(
  taskId: string,
  versionId: string,
): Promise<Esito> {
  const id = await assicuraPacchettoServer(taskId);
  if (!id.ok) return id;
  return collegaElemento(taskId, id.dati, "dichiarazione_identita", versionId);
}

/**
 * Seconda parte della dichiarazione (Protocollo Art. 4.1 "Domande non
 * dichiarate"): il video di integrazione con la domanda aggiuntiva. Stesso
 * meccanismo di 'dichiarazione_identita' — caricato nello slot dedicato 7b
 * e qui agganciato al pacchetto, nessuna copia del file. Stesse regole di
 * riservatezza: il file resta visibile solo al Titolare (migrazione 0109),
 * chi ha caricato vede i metadati dello slot e può segnalare un errore.
 */
export async function collegaDichiarazioneIntegrazione(
  taskId: string,
  versionId: string,
): Promise<Esito> {
  const id = await assicuraPacchettoServer(taskId);
  if (!id.ok) return id;
  return collegaElemento(taskId, id.dati, "dichiarazione_integrazione", versionId);
}

/**
 * "Segnala errore" sul video di dichiarazione (Protocollo Art. 4.1): chi lo
 * ha caricato apre una richiesta nel registro del Coordinatore perché il
 * campo venga liberato. Solo il depositante (o l'admin) — la RLS lo decide.
 */
export async function segnalaErroreDichiarazione(
  pacchettoId: string,
  ruolo: RuoloElemento,
  motivo?: string,
): Promise<Esito> {
  if (ruolo !== "dichiarazione_identita" && ruolo !== "dichiarazione_integrazione") {
    return errore("Ruolo dichiarazione non valido.");
  }
  const { profile } = await requireSession();
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("richieste_ricaricamento_dichiarazione")
    .insert({
      user_id: profile.id,
      pacchetto_id: pacchettoId,
      ruolo,
      motivo: motivo?.trim() || null,
    });
  if (error) return errore(error.message);
  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}

/**
 * Il Coordinatore libera il campo di dichiarazione a partire da una
 * segnalazione del Collaboratore: rimuove il riferimento dal pacchetto,
 * cancella il vecchio file (era sbagliato) e chiude la richiesta. Da quel
 * momento si può ricaricare il video corretto.
 */
export async function liberaCampoDichiarazione(richiestaId: string): Promise<Esito> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Coordinatore.");
  const admin = supabaseAdmin();
  // La chiusura usa la sessione admin: il trigger valorizza risolta_da.
  const supabase = await supabaseServer();

  const { data: richiesta } = await admin
    .from("richieste_ricaricamento_dichiarazione")
    .select("id, pacchetto_id, stato, ruolo")
    .eq("id", richiestaId)
    .single<{ id: string; pacchetto_id: string; stato: string; ruolo: string }>();
  if (!richiesta) return errore("Richiesta non trovata.");
  if (richiesta.stato !== "aperta") return errore("Richiesta già risolta.");

  // Quale video va liberato lo dice la richiesta: dichiarazione di identità
  // o di integrazione (Protocollo Art. 4.1).
  const ruolo: RuoloElemento =
    richiesta.ruolo === "dichiarazione_integrazione" ? "dichiarazione_integrazione" : "dichiarazione_identita";

  const problema = await eliminaElementoDichiarazione(richiesta.pacchetto_id, ruolo);
  if (problema) return errore(problema);

  const { error } = await supabase
    .from("richieste_ricaricamento_dichiarazione")
    .update({ stato: "risolta" })
    .eq("id", richiestaId);
  if (error) return errore(error.message);

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "liberazione_campo_dichiarazione",
      entity_type: "profile",
      entity_id: profile.id,
      meta: {
        richiesta_id: richiestaId,
        pacchetto_id: richiesta.pacchetto_id,
      },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}
/** Stati in cui il pacchetto è congelato: i suoi file non si toccano. */
const STATI_PACCHETTO_IRREVERSIBILI = new Set(["sigillato", "pec_inviata", "pec_confermata"]);

/**
 * Elimina l'elemento di dichiarazione (7/7b) dal pacchetto: riferimento in
 * pacchetto_elementi, riga in deliverable_versions e file in storage.
 * Condivisa dalla liberazione su segnalazione del Collaboratore
 * (liberaCampoDichiarazione) e dalla rimozione diretta del Coordinatore
 * (eliminaDichiarazione). Dopo il sigillo i file fanno parte del manifesto
 * PEC e non si toccano. Ritorna null in caso di successo, altrimenti il
 * messaggio d'errore da mostrare.
 */
async function eliminaElementoDichiarazione(
  pacchettoId: string,
  ruolo: RuoloElemento,
): Promise<string | null> {
  const admin = supabaseAdmin();

  const { data: pkg } = await admin
    .from("pacchetti_video")
    .select("stato")
    .eq("id", pacchettoId)
    .single<{ stato: string }>();
  if (!pkg) return "Pacchetto non trovato.";
  if (STATI_PACCHETTO_IRREVERSIBILI.has(pkg.stato)) {
    return "Il pacchetto è già sigillato: i file della dichiarazione non si possono eliminare.";
  }

  const { data: elemento } = await admin
    .from("pacchetto_elementi")
    .select("version_id, deliverable_versions!inner(bucket, storage_path)")
    .eq("pacchetto_id", pacchettoId)
    .eq("ruolo", ruolo)
    .single<{
      version_id: string;
      deliverable_versions: { bucket: string; storage_path: string };
    }>();

  if (elemento) {
    await admin
      .from("pacchetto_elementi")
      .delete()
      .eq("pacchetto_id", pacchettoId)
      .eq("ruolo", ruolo);
    await ignora(
      admin.storage
        .from(elemento.deliverable_versions.bucket)
        .remove([elemento.deliverable_versions.storage_path]),
    );
    await ignora(admin.from("deliverable_versions").delete().eq("id", elemento.version_id));
  }

  return null;
}

/**
 * URL firmati a breve scadenza del video di dichiarazione (7/7b), per il
 * solo Coordinatore: uno per la riproduzione inline (player) e uno per il
 * download. Il Collaboratore non può vedere né scaricare il file (RLS 0109):
 * queste azioni sono riservate a chi ha accesso globale.
 */
export async function urlDichiarazione(
  pacchettoId: string,
  ruolo: RuoloElemento,
): Promise<Esito<{ url: string; urlDownload: string; file_name: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Coordinatore.");
  if (ruolo !== "dichiarazione_identita" && ruolo !== "dichiarazione_integrazione") {
    return errore("Ruolo dichiarazione non valido.");
  }
  const admin = supabaseAdmin();

  const { data: elemento } = await admin
    .from("pacchetto_elementi")
    .select("deliverable_versions!inner(bucket, storage_path, file_name)")
    .eq("pacchetto_id", pacchettoId)
    .eq("ruolo", ruolo)
    .single<{
      deliverable_versions: { bucket: string; storage_path: string; file_name: string };
    }>();
  if (!elemento) return errore("Video di dichiarazione non trovato.");

  const [riproduzione, download] = await Promise.all([
    admin.storage
      .from(elemento.deliverable_versions.bucket)
      .createSignedUrl(elemento.deliverable_versions.storage_path, 600),
    admin.storage
      .from(elemento.deliverable_versions.bucket)
      .createSignedUrl(elemento.deliverable_versions.storage_path, 600, { download: true }),
  ]);
  if (!riproduzione.data || !download.data) {
    return errore("Impossibile generare il link al video.");
  }

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "accesso_video_dichiarazione",
      entity_type: "pacchetto_video",
      entity_id: pacchettoId,
      meta: {
        ruolo,
        file_name: elemento.deliverable_versions.file_name,
      },
    }),
  );

  return {
    ok: true,
    dati: {
      url: riproduzione.data.signedUrl,
      urlDownload: download.data.signedUrl,
      file_name: elemento.deliverable_versions.file_name,
    },
  };
}

/**
 * Il Coordinatore elimina direttamente il video di dichiarazione (7/7b) e
 * libera il campo per il Collaboratore — senza dover aspettare una
 * segnalazione dal gruppo. Chiude anche le eventuali richieste di
 * ricaricamento ancora aperte per quello slot. Il pacchetto deve essere
 * ancora componibile (non sigillato).
 */
export async function eliminaDichiarazione(
  pacchettoId: string,
  ruolo: RuoloElemento,
): Promise<Esito> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Coordinatore.");
  if (ruolo !== "dichiarazione_identita" && ruolo !== "dichiarazione_integrazione") {
    return errore("Ruolo dichiarazione non valido.");
  }

  const problema = await eliminaElementoDichiarazione(pacchettoId, ruolo);
  if (problema) return errore(problema);

  // Chiude le richieste di ricaricamento aperte per questo slot (se esistono):
  // il trigger valorizza risolta_at/risolta_da con la sessione del Coordinatore.
  const supabase = await supabaseServer();
  const { error: eRichieste } = await supabase
    .from("richieste_ricaricamento_dichiarazione")
    .update({ stato: "risolta" })
    .eq("pacchetto_id", pacchettoId)
    .eq("ruolo", ruolo)
    .eq("stato", "aperta");
  if (eRichieste) return errore(eRichieste.message);

  const { data: pkg } = await supabaseAdmin()
    .from("pacchetti_video")
    .select("task_id")
    .eq("id", pacchettoId)
    .single<{ task_id: string }>();
  if (pkg) revalidatePath(`/task/${pkg.task_id}`);

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "eliminazione_dichiarazione",
      entity_type: "pacchetto_video",
      entity_id: pacchettoId,
      meta: { ruolo },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}


/** Come assicuraPacchetto in PacchettoVideo.tsx, ma lato server: crea il pacchetto in bozza se non esiste. */
async function assicuraPacchettoServer(taskId: string): Promise<Esito<string>> {
  const supabase = await supabaseServer();
  const { data: esistente } = await supabase
    .from("pacchetti_video")
    .select("id")
    .eq("task_id", taskId)
    .neq("stato", "annullato")
    .maybeSingle<{ id: string }>();
  if (esistente) return { ok: true, dati: esistente.id };

  const { profile } = await requireSession();
  const { data, error } = await supabase
    .from("pacchetti_video")
    .insert({ task_id: taskId, created_by: profile.id })
    .select("id")
    .single<{ id: string }>();
  if (error) return errore(error.message);
  return { ok: true, dati: data.id };
}

/** Aggancia al pacchetto la versione esatta appena caricata. */
export async function collegaElemento(
  taskId: string,
  pacchettoId: string,
  ruolo: RuoloElemento,
  versionId: string,
): Promise<Esito> {
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("pacchetto_elementi")
    .upsert(
      { pacchetto_id: pacchettoId, ruolo, version_id: versionId },
      { onConflict: "pacchetto_id,ruolo" },
    );

  if (error) return errore(error.message);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/**
 * Toglie un elemento dal video completo e ne elimina il file.
 *
 * Funziona solo finché il pacchetto è in bozza: dopo il sigillo il database
 * rifiuta sia lo sgancio (fn_elementi_congelati) sia la cancellazione del
 * file (fn_versions_append_only), quindi questa action non può aggirare
 * l'immutabilità nemmeno per errore di programmazione.
 *
 * Prima si sgancia, poi si elimina: il vincolo di chiave esterna
 * impedirebbe l'ordine inverso.
 */
export async function rimuoviElementoPacchetto(
  taskId: string,
  pacchettoId: string,
  ruolo: RuoloElemento,
): Promise<Esito> {
  await requireSession();
  if (ruolo === "dichiarazione_identita" || ruolo === "dichiarazione_integrazione") {
    return errore(
      "Il video di dichiarazione non è rimovibile: usa il flusso 'Segnala errore' e la liberazione del Coordinatore.",
    );
  }
  const supabase = await supabaseServer();

  const { data: elemento, error: eLettura } = await supabase
    .from("pacchetto_elementi")
    .select("version_id, deliverable_versions!inner(bucket, storage_path)")
    .eq("pacchetto_id", pacchettoId)
    .eq("ruolo", ruolo)
    .single<{
      version_id: string;
      deliverable_versions: { bucket: string; storage_path: string };
    }>();

  if (eLettura || !elemento) return errore("Elemento non trovato.");

  const { error: eSgancio } = await supabase
    .from("pacchetto_elementi")
    .delete()
    .eq("pacchetto_id", pacchettoId)
    .eq("ruolo", ruolo);

  if (eSgancio) {
    return errore(
      "Non è più possibile rimuovere questo file: il video completo è sigillato.",
    );
  }

  const { error: eRiga } = await supabase
    .from("deliverable_versions")
    .delete()
    .eq("id", elemento.version_id);

  if (eRiga) return errore(traduciErroreDb(eRiga.message));

  await supabase.storage
    .from(elemento.deliverable_versions.bucket)
    .remove([elemento.deliverable_versions.storage_path]);

  // Traccia la rimozione pre-sigillo nell'audit: il ruolo dichiarazione_identita
  // non passa da qui (bloccato sopra), ma per gli altri elementi la rimozione
  // di un file prima del sigillo va comunque registrata — soprattutto quando
  // riguarda dati di terzi (nota legale 3c).
  const { profile } = await requireSession();
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "rimozione_elemento_pacchetto",
      entity_type: "pacchetto_video",
      entity_id: pacchettoId,
      meta: {
        task_id: taskId,
        ruolo,
        version_id: elemento.version_id,
        bucket: elemento.deliverable_versions.bucket,
        storage_path: elemento.deliverable_versions.storage_path,
      },
    }),
  );

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

// -------------------------------------------------------------- sigillo

/**
 * Sigilla soltanto: congela il pacchetto e calcola il manifesto, ma non
 * spedisce la PEC. Serve un'ultima occhiata al verbale prima dell'invio
 * legale — la conferma di spedizione è un passaggio separato ed esplicito
 * (bottone "Conferma e spedisci la PEC" qui sotto), non automatico.
 */
export async function sigillaPacchetto(
  taskId: string,
  pacchettoId: string,
): Promise<Esito<{ manifestHash: string }>> {
  await requireSession();
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("sigilla_pacchetto", {
    p_pacchetto: pacchettoId,
  });

  if (error) return errore(error.message);

  const manifesto = data as ManifestoPacchetto;
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: { manifestHash: manifesto.manifest_hash ?? "" } };
}

/**
 * Il gruppo segnala che il pacchetto è completo e passa la mano a chi ha
 * accesso globale. Da quel momento la composizione è congelata: la decide il
 * database, non l'interfaccia.
 */
export async function segnalaCompletato(
  taskId: string,
  pacchettoId: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  // Importa automaticamente il contenuto dei Google Doc nelle caselle.
  // Best-effort: se l'OAuth/Docs fallisce in produzione, la segnalazione
  // del completato non deve mai bloccarsi.
  try {
    const admin = supabaseAdmin();
    const { data: deliverablesLavorazione } = await admin
      .from("deliverables")
      .select("kind, google_doc_url")
      .eq("task_id", taskId)
      .in("kind", ["script", "descrizione", "titolo_youtube"]);

    const { leggiTestoGoogleDoc } = await import("@/lib/google-doc");
    const aggiornamenti: Record<string, string> = {};
    for (const d of deliverablesLavorazione ?? []) {
      if (!d.google_doc_url) continue;
      const res = await leggiTestoGoogleDoc(d.google_doc_url);
      if (res.ok) aggiornamenti[d.kind] = res.testo;
    }
    if (Object.keys(aggiornamenti).length > 0) {
      await admin.from("pacchetti_video").update(aggiornamenti).eq("id", pacchettoId);
    }
  } catch (e) {
    console.error("Import Google Doc al completato non riuscito (best-effort):", e);
  }

  const { error } = await supabase.rpc("segnala_completato", {
    p_pacchetto: pacchettoId,
  });
  if (error) return errore(error.message);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/**
 * Chi ha accesso globale ha visto il materiale e non lo ritiene pronto:
 * il pacchetto torna in composizione perché il gruppo lo sistemi.
 */
export async function rimandaInComposizione(
  taskId: string,
  pacchettoId: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("rimanda_in_composizione", {
    p_pacchetto: pacchettoId,
  });
  if (error) return errore(error.message);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

export async function annullaPacchetto(
  taskId: string,
  pacchettoId: string,
  motivo: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("annulla_pacchetto", {
    p_pacchetto: pacchettoId,
    p_motivo: motivo,
  });
  if (error) return errore(error.message);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

// ------------------------------------------------------------------ PEC

/**
 * Spedisce il verbale via PEC e registra l'esito.
 *
 * Chiunque nel polo può lanciarla: la certificazione è la tutela del gruppo,
 * non un privilegio. Il mittente è però sempre la casella PEC configurata a
 * livello di sistema, e i membri ricevono copia sulla casella ordinaria in
 * modo che la prova non stia soltanto in un unico posto.
 */
export async function inviaPecPacchetto(
  taskId: string,
  pacchettoId: string,
): Promise<Esito<{ messageId: string; allegati: string[]; esclusi: string[] }>> {
  const { isAdmin } = await requireSession();
  if (!isAdmin)
    return errore("Solo chi ha accesso globale può spedire il verbale via PEC.");
  const supabase = await supabaseServer();

  const { data: pacchetto, error: eP } = await supabase
    .from("pacchetti_video")
    .select("*")
    .eq("id", pacchettoId)
    .single<PacchettoVideoRow>();

  if (eP || !pacchetto) return errore("Pacchetto non accessibile.");
  if (!pacchetto.manifest || !pacchetto.manifest_hash) {
    return errore("Pacchetto non ancora sigillato.");
  }
  if (!["sigillato", "pec_errore"].includes(pacchetto.stato)) {
    return errore(
      pacchetto.stato === "pec_inviata" || pacchetto.stato === "pec_confermata"
        ? "Questo pacchetto è già stato certificato via PEC."
        : `Stato non valido per la spedizione: ${pacchetto.stato}.`,
    );
  }

  const manifesto: ManifestoPacchetto = {
    ...pacchetto.manifest,
    manifest_hash: pacchetto.manifest_hash,
  };

  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(e instanceof Error ? e.message : "Configurazione PEC assente");
  }

  // --- allegati -------------------------------------------------------
  //
  // I testi (descrizione, script) viaggiano sempre: pesano nulla.
  // I file si allegano dal più leggero al più pesante finché c'è spazio nel
  // messaggio, così liberatoria e copertina entrano comunque anche quando il
  // video è troppo grosso. Del video escluso viaggia l'impronta, che lo
  // identifica in modo univoco: chi l'ha realizzato conserva il proprio file
  // e in qualsiasi momento può dimostrare che è quello.
  const allegati: Allegato[] = [];
  const esclusi: string[] = [];

  let spazioResiduo = budgetAllegati(config);

  for (const el of manifesto.elementi) {
    if (el.tipo === "testo") {
      const content = Buffer.from(el.testo, "utf8");
      spazioResiduo -= content.byteLength;
      allegati.push({
        filename: `${el.ruolo}.txt`,
        content,
        contentType: "text/plain; charset=utf-8",
      });
    }
  }

  const fileOrdinati = manifesto.elementi
    .filter((el) => el.tipo === "file")
    .sort((a, b) => (a.size_bytes ?? 0) - (b.size_bytes ?? 0));

  for (const el of fileOrdinati) {
    if (el.tipo !== "file") continue;

    if ((el.size_bytes ?? 0) > spazioResiduo) {
      esclusi.push(
        `${el.file_name} (${Math.round((el.size_bytes ?? 0) / 1024 / 1024)} MB: non entra nel messaggio PEC)`,
      );
      continue;
    }

    const { data: blob, error } = await supabase.storage
      .from(el.bucket)
      .download(el.storage_path);

    if (error || !blob) {
      esclusi.push(`${el.file_name} (non scaricabile: ${error?.message ?? "assente"})`);
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    // Il file allegato deve essere lo stesso registrato al momento del
    // deposito: se le impronte divergono, meglio non spedire nulla.
    const impronta = createHash("sha256").update(buffer).digest("hex");
    if (impronta !== el.sha256) {
      return errore(
        `Il file "${el.file_name}" nello storage non corrisponde all'impronta registrata. Spedizione interrotta.`,
      );
    }

    spazioResiduo -= buffer.byteLength;
    allegati.push({
      filename: el.file_name,
      content: buffer,
      contentType: el.mime_type ?? undefined,
    });
  }

  allegati.push({
    filename: "manifesto.json",
    content: Buffer.from(JSON.stringify(manifesto, null, 2), "utf8"),
    contentType: "application/json",
  });

  // --- copia ai membri del polo ---------------------------------------
  const { data: task } = await supabase
    .from("tasks")
    .select("polo_id")
    .eq("id", taskId)
    .single<{ polo_id: string }>();

  // I destinatari PEC del gruppo, se il polo ne ha di propri; altrimenti
  // si usano i PEC_DESTINATARI globali del .env.local.
  const { data: polo } = await supabase
    .from("poli")
    .select("pec_destinatari")
    .eq("id", task?.polo_id ?? "")
    .single<{ pec_destinatari: string[] | null }>();

  const destinatari =
    polo?.pec_destinatari?.length
      ? polo.pec_destinatari
      : config.destinatari;

  const configPolo = { ...config, destinatari };

  const { data: membri } = await supabase
    .from("memberships")
    .select("profiles!inner(pec)")
    .eq("polo_id", task?.polo_id ?? "")
    .returns<{ profiles: { pec: string | null } }[]>();

  // Copie certificate: a ogni partecipante sulla sua PEC (PEC-to-PEC =
  // avvenuta consegna certificata per tutti). Se il contatto esterno ha
  // una PEC, la riceve anche lui: così ha prova legale della liberatoria.
  const { data: taskPec } = await supabase
    .from("tasks")
    .select("contatto_esterno_pec")
    .eq("id", taskId)
    .single<{ contatto_esterno_pec: string | null }>();

  const cc = (membri ?? [])
    .map((m) => m.profiles.pec)
    .filter((x): x is string => !!x);

  if (taskPec?.contatto_esterno_pec) {
    cc.push(taskPec.contatto_esterno_pec);
  }

  // --- spedizione -----------------------------------------------------
  const nomiAllegati = allegati.map((a) => a.filename);
  const admin = supabaseAdmin();

  try {
    const { messageId } = await spedisciPec({
      config: configPolo,
      oggetto: oggettoVerbale(manifesto),
      testo: corpoTesto(manifesto, nomiAllegati),
      html: corpoHtml(manifesto, nomiAllegati),
      allegati,
      copiaConoscenza: cc,
    });

    await admin.rpc("registra_esito_pec", {
      p_pacchetto: pacchettoId,
      p_stato: "pec_inviata",
      p_message_id: messageId,
      p_destinatari: configPolo.destinatari,
      p_errore: null,
      p_note: esclusi.length ? `Non allegati: ${esclusi.join("; ")}` : null,
    });

    // La copia su Drive NON parte più da qui: il trigger del database ha
    // appena messo la riga esportazioni_drive a 'da_fare' (dentro
    // registra_esito_pec) e la Edge Function fa il resto in background.

    revalidatePath(`/task/${taskId}`);
    return {
      ok: true,
      dati: { messageId, allegati: nomiAllegati, esclusi },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore di spedizione";
    await admin.rpc("registra_esito_pec", {
      p_pacchetto: pacchettoId,
      p_stato: "pec_errore",
      p_message_id: null,
      p_destinatari: configPolo.destinatari,
      p_errore: msg,
      p_note: null,
    });
    revalidatePath(`/task/${taskId}`);
    return errore(`PEC non spedita: ${msg}`);
  }
}

/** Archiviazione manuale della ricevuta di avvenuta consegna (solo accesso globale). */
export async function confermaRicevutaPec(
  taskId: string,
  pacchettoId: string,
  note: string,
): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione non consentita.");

  const admin = supabaseAdmin();
  const { error } = await admin.rpc("registra_esito_pec", {
    p_pacchetto: pacchettoId,
    p_stato: "pec_confermata",
    p_message_id: null,
    p_destinatari: null,
    p_errore: null,
    p_note: note,
  });
  if (error) return errore(error.message);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/** Chiede (o richiede di nuovo) la copia su Drive di un pacchetto. */
export async function richiediEsportazioneDrive(
  pacchettoId: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("richiedi_esportazione_drive", {
    p_pacchetto: pacchettoId,
  });
  if (error) return errore(error.message);

  revalidatePath(`/task/[taskId]`, "page");
  return { ok: true, dati: undefined };
}

/** Importa il testo di un Google Doc collegato (usato per script/descrizione/titolo). */
export async function importaTestoGoogleDoc(
  url: string,
  campo: "script" | "descrizione" | "titolo_youtube" = "descrizione",
): Promise<
  { ok: true; dati: { testo: string; avvisi: string[] } } | { ok: false; errore: string }
> {
  await requireSession();
  const { leggiTestoGoogleDoc } = await import("@/lib/google-doc");
  const res = await leggiTestoGoogleDoc(url);
  if (!res.ok) return errore(res.errore);

  // Il testo importato viene subito portato alla forma standard.
  const { valore, diff } = normalizzaConDiff(campo, res.testo);
  const avvisi = diff ? [messaggioDiff(diff)] : [];
  return { ok: true, dati: { testo: valore ?? "", avvisi } };
}


