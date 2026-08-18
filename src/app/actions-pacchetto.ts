"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { normalizzaConDiff, messaggioDiff } from "@/lib/formato";
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
import { verificaPersoneVideo, verificaPersoneImmagine } from "@/lib/gemini";

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

  // --- controllo riconoscimento automatico (video e copertina) ---
  // Ognuno dei due elementi finisce pubblicato: una copertina con una
  // persona esterna non dichiarata va bloccata allo stesso modo di un
  // video. Ogni elemento è verificato per conto suo (vedi ruolo in
  // verifiche_riconoscimento), così sostituire uno dei due non nasconde
  // un vecchio esito negativo dell'altro.
  if (ruolo === "video" || ruolo === "copertina") {
    after(() => avviaVerificaPersone(taskId, pacchettoId, versionId, ruolo));
  }

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/**
 * Esegue il riconoscimento automatico (Fase D) in background, per il video
 * o per la copertina. Scarica il file, le foto dei membri con consenso,
 * chiama Gemini e scrive il risultato nella tabella verifiche_riconoscimento.
 */
async function avviaVerificaPersone(
  taskId: string,
  pacchettoId: string,
  versionId: string,
  ruolo: "video" | "copertina",
): Promise<void> {
  try {
    const admin = supabaseAdmin();

    // 1) Recupera la versione del file e il polo del task
    const { data: versione } = await admin
      .from("deliverable_versions")
      .select("storage_path, bucket, mime_type")
      .eq("id", versionId)
      .single<{ storage_path: string; bucket: string; mime_type: string | null }>();
    if (!versione) return;

    const { data: task } = await admin
      .from("tasks")
      .select("polo_id")
      .eq("id", taskId)
      .single<{ polo_id: string }>();
    if (!task?.polo_id) return;

    // 2) Scarica il file da Storage
    const { data: blob, error: eDown } = await admin.storage
      .from(versione.bucket)
      .download(versione.storage_path);
    if (eDown || !blob) return;

    const fileBuffer = Buffer.from(await blob.arrayBuffer());
    const mimeType = versione.mime_type ?? (ruolo === "video" ? "video/mp4" : "image/jpeg");

    // 3) Trova i membri del polo con foto e consenso riconoscimento_foto
    const { data: membri } = await admin
      .from("memberships")
      .select("user_id, profiles!inner(id, foto_path)")
      .eq("polo_id", task.polo_id)
      .not("profiles.foto_path", "is", null)
      .returns<{ user_id: string; profiles: { id: string; foto_path: string } }[]>();

    if (!membri?.length) {
      await scriviEsito(admin, pacchettoId, ruolo, "errore", "Nessun membro del gruppo ha una foto profilo.");
      return;
    }

    // Filtra: solo chi ha dato il consenso riconoscimento_foto
    const userIds = membri.map((m) => m.user_id);
    const { data: consensi } = await admin
      .from("consensi")
      .select("user_id")
      .in("user_id", userIds)
      .eq("tipo", "riconoscimento_foto");
    const conConsenso = new Set((consensi ?? []).map((c) => c.user_id));

    const fotoRiferimento: { profileId: string; base64: string; mimeType: string }[] = [];

    for (const m of membri) {
      if (!conConsenso.has(m.user_id)) continue;
      const fotoPath = m.profiles.foto_path;
      const { data: fotoBlob, error: eFoto } = await admin.storage
        .from("profili")
        .download(fotoPath);
      if (eFoto || !fotoBlob) continue;

      const base64 = Buffer.from(await fotoBlob.arrayBuffer()).toString("base64");
      fotoRiferimento.push({
        profileId: m.profiles.id,
        base64,
        mimeType: fotoBlob.type || "image/jpeg",
      });
    }

    if (!fotoRiferimento.length) {
      await scriviEsito(admin, pacchettoId, ruolo, "errore", "Nessun membro ha dato il consenso al riconoscimento foto.");
      return;
    }

    // 4) Chiama Gemini (video: File API; copertina: inlineData diretto)
    const esito =
      ruolo === "video"
        ? await verificaPersoneVideo({ videoBuffer: fileBuffer, videoMimeType: mimeType, fotoRiferimento })
        : await verificaPersoneImmagine({
            immagineBase64: fileBuffer.toString("base64"),
            mimeType,
            fotoRiferimento,
          });

    // 5) Scrivi risultato
    await scriviEsito(admin, pacchettoId, ruolo, esito.esito, esito.dettaglio);
  } catch (e) {
    const admin = supabaseAdmin();
    await scriviEsito(admin, pacchettoId, ruolo, "errore", e instanceof Error ? e.message : "Errore durante la verifica.");
  }
}

async function scriviEsito(
  admin: ReturnType<typeof supabaseAdmin>,
  pacchettoId: string,
  ruolo: "video" | "copertina",
  esito: string,
  dettaglio: string,
): Promise<void> {
  try {
    await admin.from("verifiche_riconoscimento").insert({
      pacchetto_id: pacchettoId,
      ruolo,
      esito,
      dettaglio,
    });
  } catch {
    // best-effort: se la scrittura fallisce non blocca nulla
  }
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

/** Correzione manuale admin: segna il riconoscimento come ok. */
export async function correggiRiconoscimento(pacchettoId: string): Promise<Esito> {
  const { profile, isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'amministratore.");

  const admin = supabaseAdmin();
  const { error } = await admin.from("verifiche_riconoscimento").insert([
    {
      pacchetto_id: pacchettoId,
      ruolo: "video",
      esito: "nessuna_persona_esterna",
      dettaglio: "Corretto manualmente dall'amministratore.",
      corretto_da: profile.id,
    },
    {
      pacchetto_id: pacchettoId,
      ruolo: "copertina",
      esito: "nessuna_persona_esterna",
      dettaglio: "Corretto manualmente dall'amministratore.",
      corretto_da: profile.id,
    },
  ]);

  if (error) return errore(error.message);
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


