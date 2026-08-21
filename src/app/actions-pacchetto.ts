"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { normalizzaConDiff, messaggioDiff } from "@/lib/formato";
import { salvaPacchettoSchema } from "@/lib/schemi";
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

  if (eRiga) return errore(eRiga.message);

  await supabase.storage
    .from(elemento.deliverable_versions.bucket)
    .remove([elemento.deliverable_versions.storage_path]);

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


