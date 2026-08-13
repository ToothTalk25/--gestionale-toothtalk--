"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import type { Archivio, DeliverableKind, TaskStatus, VersionOrigin } from "@/lib/types";

/** Il bucket è determinato dal server, mai scelto dal client. */
function bucketPer(origin: VersionOrigin, archivio: Archivio): string {
  if (origin === "admin_edit") return "revisioni";
  return archivio === "finale" ? "finali" : "originali";
}

/**
 * Nota trasversale: queste azioni NON implementano i permessi.
 * I permessi vivono nella RLS. Qui si costruiscono solo query oneste e si
 * traducono gli errori del database in messaggi leggibili. Se una policy
 * cambia, l'applicazione si adegua da sola.
 */

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function fallita(e: { message: string } | null, fallback: string): Esito<never> {
  const msg = e?.message ?? fallback;
  // Gli errori sollevati dai trigger arrivano già in italiano e parlanti.
  if (msg.includes("row-level security") || msg.includes("violates"))
    return { ok: false, errore: "Operazione non consentita dal tuo ruolo." };
  return { ok: false, errore: msg };
}

// ------------------------------------------------------------------ task

export async function creaTask(formData: FormData): Promise<Esito<{ id: string }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const polo_id = String(formData.get("polo_id") ?? "");
  const titolo = String(formData.get("titolo") ?? "").trim();
  const script = String(formData.get("script") ?? "").trim() || null;
  const scadenza = String(formData.get("scadenza") ?? "").trim() || null;
  const formato_id = String(formData.get("formato_id") ?? "").trim() || null;

  if (!titolo) return { ok: false, errore: "Il titolo è obbligatorio." };

  const { data, error } = await supabase
    .from("tasks")
    .insert({ polo_id, titolo, script, scadenza, formato_id, created_by: profile.id })
    .select("id")
    .single();

  if (error) return fallita(error, "Creazione progetto fallita");

  // Crea i Google Doc di lavorazione in background
  const { data: poloRow } = await supabase
    .from("poli")
    .select("nome, drive_folder_id")
    .eq("id", polo_id)
    .single<{ nome: string; drive_folder_id: string | null }>();
  if (poloRow) {
    after(async () => {
      const { creaDocumentiLavorazione } = await import("@/lib/google-doc");
      await creaDocumentiLavorazione(data.id, poloRow.nome, titolo, poloRow.drive_folder_id).catch((e) => {
        console.error("Creazione documenti di lavorazione fallita:", e);
      });
    });
  }

  revalidatePath(`/polo/${polo_id}`);
  revalidatePath("/dashboard");
  return { ok: true, dati: { id: data.id } };
}

export async function aggiornaTesti(
  taskId: string,
  campi: { titolo?: string; script?: string | null; note_admin?: string | null; numero_video?: number | null },
): Promise<Esito> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("tasks").update(campi).eq("id", taskId);
  if (error) return fallita(error, "Aggiornamento fallito");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/**
 * Elimina completamente un progetto (solo chi ha accesso globale).
 *
 * La RPC elimina_progetto verifica il permesso e rifiuta i progetti bloccati
 * o con un pacchetto già certificato via PEC. I file vengono rimossi dallo
 * storage dopo la cancellazione delle righe (best-effort: se la rimozione
 * fallisce resta un file orfano invisibile, innocuo).
 */
export async function eliminaProgetto(taskId: string): Promise<Esito> {
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  // Raccoglie i path dello storage PRIMA che la RPC cancelli le righe.
  const { data: versioni } = await supabase
    .from("deliverable_versions")
    .select("bucket, storage_path, deliverables!inner(task_id)")
    .eq("deliverables.task_id", taskId)
    .returns<{ bucket: string; storage_path: string }[]>();

  // La RPC verifica l'accesso globale e cancella tutto (rifiuta i progetti
  // certificati via PEC o bloccati).
  const { error } = await supabase.rpc("elimina_progetto", { p_task: taskId });
  if (error) return fallita(error, "Eliminazione non consentita");

  // Rimozione best-effort dei file, ormai orfani.
  const perBucket = new Map<string, string[]>();
  for (const v of versioni ?? []) {
    const arr = perBucket.get(v.bucket) ?? [];
    arr.push(v.storage_path);
    perBucket.set(v.bucket, arr);
  }
  for (const [bucket, paths] of perBucket) {
    await admin.storage.from(bucket).remove(paths).catch(() => {});
  }

  revalidatePath("/dashboard");
  return { ok: true, dati: undefined };
}

/**
 * Rimuove il file fisico dallo storage Supabase mantenendo la riga
 * e l'impronta SHA256 (prova legale). Solo per file del bucket finali
 * di pacchetti già certificati via PEC.
 */
export async function archiviaFileFinale(
  taskId: string,
  versionId: string,
): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return fallita({ message: "Accesso negato" }, "Solo chi ha accesso globale può archiviare un file.");

  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  const { data: versione, error: eL } = await supabase
    .from("deliverable_versions")
    .select("storage_path, bucket, archiviato_esterno")
    .eq("id", versionId)
    .single<{ storage_path: string; bucket: string; archiviato_esterno: boolean }>();

  if (eL || !versione) return fallita(eL ?? { message: "File non trovato." }, "File non trovato.");
  if (versione.archiviato_esterno) return fallita(null, "Gia archiviato.");

  const { error: eA } = await supabase.rpc("archivia_file_finale", {
    p_version: versionId,
  });
  if (eA) return fallita(eA, "Archiviazione non consentita");

  await admin.storage.from(versione.bucket).remove([versione.storage_path]).catch(() => {});

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}


/** Archivia in blocco tutti i file di un pacchetto sigillato (uno per ruolo). */
export async function archiviaPacchettoCompleto(
  taskId: string,
  pacchettoId: string,
): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return fallita({ message: "Accesso negato" }, "Solo chi ha accesso globale può archiviare.");

  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  const { data: versioni } = await supabase
    .from("pacchetto_elementi")
    .select("deliverable_versions!inner(id, storage_path, bucket, archiviato_esterno)")
    .eq("pacchetto_id", pacchettoId);

  const daArchiviare = (versioni ?? [])
    .map((v) => v.deliverable_versions as unknown as { id: string; storage_path: string; bucket: string; archiviato_esterno: boolean })
    .filter((v) => v.bucket === "finali" && !v.archiviato_esterno);

  for (const v of daArchiviare) {
    const { error } = await supabase.rpc("archivia_file_finale", { p_version: v.id });
    if (!error) {
      await admin.storage.from(v.bucket).remove([v.storage_path]).catch(() => {});
    }
  }

  revalidatePath("/revisione");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/**
 * Il gruppo dichiara se il video mostra una persona esterna al progetto
 * (es. un'intervista). Se sì, la liberatoria diventa obbligatoria nel
 * pacchetto pubblicabile: lo verifica sigilla_pacchetto() nel database,
 * non questa action — qui si scrive solo il dato.
 */
export async function impostaCoinvolgeTerzi(
  taskId: string,
  coinvolgeTerzi: boolean,
): Promise<Esito> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("tasks")
    .update({ coinvolge_terzi: coinvolgeTerzi })
    .eq("id", taskId);
  if (error) return fallita(error, "Aggiornamento fallito");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

export async function cambiaStato(
  taskId: string,
  status: TaskStatus,
): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
  if (error) return fallita(error, "Cambio di stato rifiutato");

  const { data: t } = await supabase
    .from("tasks")
    .select("polo_id")
    .eq("id", taskId)
    .single();

  await supabase.from("audit_log").insert({
    actor: profile.id,
    actor_role: profile.role,
    action: "cambio_stato",
    entity_type: "task",
    entity_id: taskId,
    polo_id: t?.polo_id ?? null,
    meta: { status },
  });

  revalidatePath(`/task/${taskId}`);
  revalidatePath("/dashboard");
  return { ok: true, dati: undefined };
}

/** Congelamento dei contenuti: riservato a chi ha accesso globale (policy + trigger). */
export async function impostaBlocco(
  taskId: string,
  locked: boolean,
): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.from("tasks").update({ locked }).eq("id", taskId);
  if (error) return fallita(error, "Operazione non consentita");

  await supabase.from("audit_log").insert({
    actor: profile.id,
    actor_role: profile.role,
    action: locked ? "blocco_progetto" : "sblocco_progetto",
    entity_type: "task",
    entity_id: taskId,
  });

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

// ---------------------------------------------------------- deliverable

/**
 * Prepara lo slot di upload. Restituisce l'id della deliverable e il prefisso
 * di path che le policy di storage si aspettano:
 *   {polo_id}/{task_id}/{deliverable_id}/
 */
export async function preparaUpload(
  taskId: string,
  kind: DeliverableKind,
  titolo?: string,
): Promise<Esito<{ deliverableId: string; prefix: string }>> {
  const supabase = await supabaseServer();

  const { data: task, error: eTask } = await supabase
    .from("tasks")
    .select("id, polo_id, locked")
    .eq("id", taskId)
    .single();

  if (eTask || !task) return { ok: false, errore: "Progetto non accessibile." };

  // Una deliverable per tipo: i caricamenti successivi diventano versioni,
  // non file paralleli. È questo che tiene insieme la catena probatoria.
  const { data: esistente } = await supabase
    .from("deliverables")
    .select("id")
    .eq("task_id", taskId)
    .eq("kind", kind)
    .maybeSingle();

  let deliverableId: string | undefined = esistente?.id;

  if (!deliverableId) {
    const { data, error } = await supabase
      .from("deliverables")
      .insert({ task_id: taskId, kind, titolo: titolo ?? null })
      .select("id")
      .single();
    if (error) return fallita(error, "Creazione deliverable fallita");
    deliverableId = data.id as string;
  }

  if (!deliverableId) return { ok: false, errore: "Deliverable non creata." };

  return {
    ok: true,
    dati: {
      deliverableId,
      prefix: `${task.polo_id}/${task.id}/${deliverableId}/`,
    },
  };
}

/**
 * Registra nel registro probatorio un file già caricato su Storage.
 * Il numero di versione, la catena di hash e il sigillo temporale sono
 * calcolati dal database (trigger fn_seal_version): qualunque valore
 * inviato dal client per quei campi verrebbe scartato.
 */
export async function registraVersione(input: {
  taskId: string;
  deliverableId: string;
  origin: VersionOrigin;
  archivio: Archivio;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
  note?: string | null;
}): Promise<Esito<{ versionId: string; recordHash: string; versionNo: number }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const bucket = bucketPer(input.origin, input.archivio);

  // Il record non deve poter esistere senza il file: verifichiamo che
  // l'oggetto sia davvero nel bucket prima di sigillarlo.
  const dir = input.storagePath.split("/").slice(0, -1).join("/");
  const nome = input.storagePath.split("/").pop()!;
  const { data: elenco } = await supabase.storage.from(bucket).list(dir, {
    search: nome,
    limit: 1,
  });
  if (!elenco?.length) {
    return { ok: false, errore: "File non trovato nello storage: upload incompleto." };
  }

  const { data, error } = await supabase
    .from("deliverable_versions")
    .insert({
      deliverable_id: input.deliverableId,
      origin: input.origin,
      bucket,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      sha256: input.sha256,
      uploaded_by: profile.id,
      note: input.note ?? null,
      // version_no / record_hash / sealed_at: assegnati dal trigger.
    })
    .select("id, record_hash, version_no")
    .single();

  if (error) return fallita(error, "Registrazione del file fallita");

  revalidatePath(`/task/${input.taskId}`);
  revalidatePath("/dashboard");
  return {
    ok: true,
    dati: {
      versionId: data.id,
      recordHash: data.record_hash,
      versionNo: data.version_no,
    },
  };
}

/**
 * Elimina un file dallo spazio di lavoro.
 *
 * Vale solo per i materiali di lavorazione: sul bucket 'finali' il database
 * rifiuta la cancellazione (trigger fn_versions_append_only), quindi questa
 * action non può diventare per sbaglio una scorciatoia per svuotare il
 * video completo.
 *
 * Ordine delle operazioni: prima la riga, poi il file. Se il secondo passo
 * fallisce resta un file inutilizzato nello storage — invisibile e innocuo —
 * invece di una riga che punta a un file inesistente, che romperebbe i
 * download.
 */
export async function eliminaVersione(
  taskId: string,
  versionId: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { data: versione, error: eLettura } = await supabase
    .from("deliverable_versions")
    .select("id, bucket, storage_path")
    .eq("id", versionId)
    .single<{ id: string; bucket: string; storage_path: string }>();

  if (eLettura || !versione) return { ok: false, errore: "File non trovato." };

  const { error: eRiga } = await supabase
    .from("deliverable_versions")
    .delete()
    .eq("id", versionId);

  if (eRiga) return fallita(eRiga, "Eliminazione non consentita");

  // Se questa fallisce il file resta orfano nello storage: non è un errore
  // per chi sta usando la piattaforma, la riga è già sparita.
  await supabase.storage.from(versione.bucket).remove([versione.storage_path]);

  revalidatePath(`/task/${taskId}`);
  revalidatePath("/dashboard");
  return { ok: true, dati: undefined };
}

/** URL firmato a scadenza breve: nessun file è mai pubblico. */
export async function urlFirmato(
  bucket: string,
  path: string,
  secondi = 300,
): Promise<Esito<{ url: string }>> {
  await requireSession();
  const supabase = await supabaseServer();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, secondi, { download: true });

  if (error || !data) return fallita(error, "Download non autorizzato");
  return { ok: true, dati: { url: data.signedUrl } };
}

/** Imposta o rimuove il link al Google Doc per un deliverable di tipo script o descrizione. */
export async function impostaGoogleDocUrl(
  taskId: string,
  kind: DeliverableKind,
  url: string | null,
): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return fallita(null, "Operazione riservata all'amministratore.");

  // Solo URL Google Docs legittimi: niente javascript:, niente schemi
  // arbitrari, niente host di terze parti. React scapa già il valore nel
  // rendering, ma questa validazione impedisce di salvare link pericolosi.
  if (url !== null) {
    const u = url.trim();
    if (
      !u.startsWith("https://docs.google.com/document/") &&
      !u.startsWith("https://docs.google.com/document/u/")
    ) {
      return fallita(null, "Inserisci un link valido di Google Documenti (docs.google.com/document/...).");
    }
    url = u;
  }

  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  // Trova o crea il deliverable
  const { data: es } = await supabase
    .from("deliverables")
    .select("id")
    .eq("task_id", taskId)
    .eq("kind", kind)
    .maybeSingle<{ id: string }>();

  if (es) {
    const { error } = await admin
      .from("deliverables")
      .update({ google_doc_url: url })
      .eq("id", es.id);
    if (error) return fallita(error, error.message);
  } else {
    const { error } = await admin
      .from("deliverables")
      .insert({ task_id: taskId, kind, google_doc_url: url });
    if (error) return fallita(error, error.message);
  }

  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

