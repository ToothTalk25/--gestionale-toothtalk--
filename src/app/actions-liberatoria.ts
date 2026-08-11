"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";

function errore(msg: string): { ok: false; errore: string } {
  return { ok: false, errore: msg };
}

// ------------------------------------------------------------------ email

async function inviaEmailLink(destinatario: string, token: string): Promise<void> {
  const link = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/carica-liberatoria?token=${token}`;

  // Se le credenziali non sono configurate, il link va copiato a mano
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.log("--------------------------------------------------");
    console.log("Email non configurata (MAIL_USER/MAIL_PASS mancanti).");
    console.log("Copia questo link e invialo manualmente:");
    console.log("");
    console.log("  Destinatario: " + destinatario);
    console.log("  Link: " + link);
    console.log("--------------------------------------------------");
    return;
  }

  // nodemailer con Gmail SMTP
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to: destinatario,
    subject: "Liberatoria — ToothTalk",
    text:
      `Salve,\n\n` +
      `Lei compare in un video del progetto ToothTalk. Per favore, ` +
      `scarichi il modulo di liberatoria, lo firmi e lo carichi a questo link:\n\n` +
      `${link}\n\n` +
      `Il link è valido 7 giorni. Grazie.\n\n` +
      `— ToothTalk`,
  });
}

// ------------------------------------------------------------------ azioni

/** Aggiorna l'email del contatto esterno per la liberatoria. */
export async function aggiornaContattoEsterno(
  taskId: string,
  contatto_esterno_email: string | null,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("tasks")
    .update({ contatto_esterno_email })
    .eq("id", taskId);
  if (error) return errore(error.message);
  revalidatePath(`/task/${taskId}`);
  return { ok: true };
}

/** Crea una richiesta di liberatoria e restituisce il token. Solo admin. */
export async function inviaRichiestaLiberatoria(
  taskId: string,
  contatto_email: string,
): Promise<{ ok: true; token: string } | { ok: false; errore: string }> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Solo chi ha accesso globale può inviare la richiesta.");

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("richieste_liberatoria")
    .insert({
      task_id: taskId,
      contatto_email,
      scade_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("token")
    .single<{ token: string }>();

  if (error) return errore(error.message);

  // Invia l'email con il link (o lo stampa in console se MAIL_* non configurati)
  await inviaEmailLink(contatto_email, data.token);

  revalidatePath(`/task/${taskId}`);
  return { ok: true, token: data.token };
}

/** Carica la liberatoria da una richiesta pubblica (via token + FormData). */
export async function caricaLiberatoriaPubblica(
  token: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const file = formData.get("file") as File | null;
  if (!file) return errore("Nessun file ricevuto.");

  const admin = supabaseAdmin();

  // 1. verifica token
  const { data: richiesta, error: eTok } = await admin
    .rpc("verifica_token_liberatoria", { p_token: token });

  if (eTok || !richiesta?.length) return errore("Token non valido o scaduto.");

  const { task_id } = richiesta[0] as { task_id: string };

  // 2. trova o crea la deliverable "finale_liberatoria"
  const { data: del } = await admin
    .from("deliverables")
    .select("id")
    .eq("task_id", task_id)
    .eq("kind", "finale_liberatoria")
    .single<{ id: string }>();

  let deliverableId: string;
  if (!del) {
    const { data: nuovo, error: eDel } = await admin
      .from("deliverables")
      .insert({ task_id, kind: "finale_liberatoria", created_by: null })
      .select("id")
      .single<{ id: string }>();
    if (eDel || !nuovo) return errore("Impossibile creare lo slot di upload.");
    deliverableId = nuovo.id;
  } else {
    deliverableId = del.id;
  }

  // 3. id di chi ha accesso globale (per uploaded_by, che non può essere null)
  const { data: profilo } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .eq("attivo", true)
    .limit(1)
    .single<{ id: string }>();
  if (!profilo) return errore("Nessun admin trovato.");

  // 4. calcola impronta
  const { createHash, randomUUID } = await import("node:crypto");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const storagePath = `${task_id}/finale_liberatoria/${randomUUID()}__${file.name}`;

  // 5. carica su storage (admin, bypassa RLS)
  const { error: eUpload } = await admin
    .storage.from("finali")
    .upload(storagePath, buffer, {
      contentType: file.type || "application/pdf",
      upsert: false,
    });
  if (eUpload) return errore("Upload fallito: " + eUpload.message);

  // 6. registra versione
  const { data: versione, error: eVers } = await admin
    .from("deliverable_versions")
    .insert({
      deliverable_id: deliverableId,
      origin: "originale",
      bucket: "finali",
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || "application/pdf",
      size_bytes: buffer.byteLength,
      sha256,
      uploaded_by: profilo.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (eVers) {
    await admin.storage.from("finali").remove([storagePath]).catch(() => {});
    return errore("Registrazione fallita: " + eVers.message);
  }

  // 7. marca come caricata
  const { error: eReg } = await admin
    .rpc("registra_upload_liberatoria", { p_token: token, p_version: versione.id });
  if (eReg) {
    return errore("Token non valido o gia usato: " + eReg.message);
  }

  return { ok: true };
}

/** Firma la liberatoria online: il contatto inserisce nome e firma, il sistema genera il documento e lo archivia. */
export async function firmaLiberatoriaOnline(
  token: string,
  nome: string,
  firma: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const admin = supabaseAdmin();

  const { data: richiesta, error: eTok } = await admin
    .rpc("verifica_token_liberatoria", { p_token: token });
  if (eTok || !richiesta?.length) return errore("Token non valido o scaduto.");
  const { task_id } = richiesta[0] as { task_id: string };

  const data = new Date().toISOString().slice(0, 10);
  const testo =
    `LIBERATORIA PRIVACY / IMMAGINE\n` +
    `Progetto: ToothTalk\n` +
    `Data: ${data}\n\n` +
    `Il/La sottoscritto/a: ${nome}\n` +
    `DICHIARA di acconsentire alla ripresa e alla pubblicazione della\n` +
    `propria immagine e voce nel video del progetto ToothTalk, secondo\n` +
    `l'informativa privacy consultabile sul sito del progetto.\n\n` +
    `Firma: ${firma}\n\n` +
    `Documento generato e certificato digitalmente dal sistema ToothTalk.`;

  const { randomUUID } = await import("node:crypto");
  const buffer = Buffer.from(testo, "utf8");
  const sha256 = (await import("node:crypto")).createHash("sha256").update(buffer).digest("hex");
  const fileName = `liberatoria_${nome.replace(/\s+/g, "_").slice(0, 50)}.txt`;
  const storagePath = `${task_id}/finale_liberatoria/${randomUUID()}__${fileName}`;

  const { data: del } = await admin.from("deliverables").select("id")
    .eq("task_id", task_id).eq("kind", "finale_liberatoria").single<{ id: string }>();
  let deliverableId: string;
  if (!del) {
    const { data: nuovo, error: eDel } = await admin.from("deliverables")
      .insert({ task_id, kind: "finale_liberatoria", created_by: null })
      .select("id").single<{ id: string }>();
    if (eDel || !nuovo) return errore("Impossibile creare lo slot di upload.");
    deliverableId = nuovo.id;
  } else { deliverableId = del.id; }

  const { data: profilo } = await admin.from("profiles").select("id")
    .eq("role", "admin").eq("attivo", true).limit(1).single<{ id: string }>();
  if (!profilo) return errore("Nessun admin trovato.");

  const { error: eUpload } = await admin.storage.from("finali").upload(storagePath, buffer, {
    contentType: "text/plain; charset=utf-8", upsert: false,
  });
  if (eUpload) return errore("Upload fallito: " + eUpload.message);

  const { data: versione, error: eVers } = await admin.from("deliverable_versions").insert({
    deliverable_id: deliverableId, origin: "originale", bucket: "finali",
    storage_path: storagePath, file_name: fileName, mime_type: "text/plain; charset=utf-8",
    size_bytes: buffer.byteLength, sha256, uploaded_by: profilo.id,
  }).select("id").single<{ id: string }>();
  if (eVers) {
    await admin.storage.from("finali").remove([storagePath]).catch(() => {});
    return errore("Registrazione fallita: " + eVers.message);
  }

  const { error: eReg } = await admin.rpc("registra_upload_liberatoria", {
    p_token: token, p_version: versione.id,
  });
  if (eReg) return errore("Token non valido o gia usato: " + eReg.message);

  return { ok: true };
}

