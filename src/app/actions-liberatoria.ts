"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";

function errore(msg: string): { ok: false; errore: string } {
  return { ok: false, errore: msg };
}

// ------------------------------------------------------------------ email

async function inviaEmailLink(destinatario: string, token: string, usaPec: boolean): Promise<void> {
  const link = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/carica-liberatoria?token=${token}`;

  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.log("Email non configurata. Link da inviare manualmente a " + destinatario + ": " + link);
    return;
  }

  const nodemailer = await import("nodemailer");

  if (usaPec) {
    // Via PEC: mittente toothtalk@pec.it, SMTP Aruba
    const pecConf = process.env.PEC_USER && process.env.PEC_PASSWORD;
    if (!pecConf) { console.log("PEC non configurata, link: " + link); return; }
    const transporter = nodemailer.createTransport({
      host: process.env.PEC_HOST || "smtps.pec.aruba.it",
      port: Number(process.env.PEC_PORT || 465),
      secure: true,
      auth: { user: process.env.PEC_USER, pass: process.env.PEC_PASSWORD },
    });
    await transporter.sendMail({
      from: process.env.PEC_MITTENTE || process.env.PEC_USER,
      to: destinatario,
      subject: "Liberatoria — ToothTalk",
      text: `Salve,\n\nLei compare in un video del progetto ToothTalk. ` +
        `Può compilare e firmare la liberatoria a questo link:\n\n${link}\n\n` +
        `Il link è valido 7 giorni. Grazie.\n\n— ToothTalk`,
    });
  } else {
    // Via Gmail
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 587, secure: false,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: destinatario,
      subject: "Liberatoria — ToothTalk",
      text: `Salve,\n\nLei compare in un video del progetto ToothTalk. ` +
        `Può compilare e firmare la liberatoria a questo link:\n\n${link}\n\n` +
        `Il link è valido 7 giorni. Grazie.\n\n— ToothTalk`,
    });
  }
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

/** Aggiorna la PEC del contatto esterno per la liberatoria. */
export async function aggiornaContattoPec(
  taskId: string,
  contatto_esterno_pec: string | null,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("tasks")
    .update({ contatto_esterno_pec })
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

  // Se il contatto ha una PEC, la usiamo come destinatario e instradiamo via PEC.
  const { data: task } = await (await supabaseServer()).from("tasks")
    .select("contatto_esterno_pec").eq("id", taskId).single<{ contatto_esterno_pec: string | null }>();
  const pec = task?.contatto_esterno_pec?.trim();
  const usaPec = !!pec;
  const destinatario = pec || contatto_email;

  await inviaEmailLink(destinatario, data.token, usaPec);

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
    .rpc("registra_upload_liberatoria", { p_token: token, p_version: versione.id, p_metodo: "upload_manuale" });
  if (eReg) {
    return errore("Token non valido o gia usato: " + eReg.message);
  }

  return { ok: true };
}

/** Firma la liberatoria online: il contatto inserisce nome e firma, il sistema genera il documento e lo archivia. */
export async function firmaLiberatoriaOnline(
  token: string,
  nome: string,
  firmaImg: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const admin = supabaseAdmin();

  const { data: richiesta, error: eTok } = await admin
    .rpc("verifica_token_liberatoria", { p_token: token });
  if (eTok || !richiesta?.length) return errore("Token non valido o scaduto.");
  const { task_id } = richiesta[0] as { task_id: string };

  // Legge se il contatto ha PEC: se sì riceverà la PEC di sigillo,
  // altrimenti gli mandiamo subito una conferma via email ordinaria.
  const { data: td } = await admin.from("tasks")
    .select("contatto_esterno_email, contatto_esterno_pec")
    .eq("id", task_id).single<{ contatto_esterno_email: string | null; contatto_esterno_pec: string | null }>();
  const haPec = !!td?.contatto_esterno_pec?.trim();

  const data = new Date().toISOString().slice(0, 10);
  const html =
    `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Liberatoria — ToothTalk</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#1e293b}` +
    `h1{font-size:1.2em;margin-bottom:.5em}img.logo{height:36px}.firma{border:1px solid #cbd5e1;border-radius:8px;padding:8px;max-width:280px}` +
    `.data{color:#64748b;font-size:.85em;margin-top:2em}</style></head><body>` +
    `<img src="https://toothtalk.it/logo-toothtalk.svg" class="logo" alt="ToothTalk"><h1>Liberatoria privacy / immagine</h1>` +
    `<p>Con la presente il/la sottoscritto/a <strong>${nome}</strong> autorizza il progetto <strong>ToothTalk</strong> — ` +
    `progetto di divulgazione odontoiatrica — a riprendere e pubblicare la propria immagine e voce nel video per il ` +
    `quale è stato/a intervistato/a, esclusivamente per le finalità del progetto e in conformità all'informativa privacy.</p>` +
    `<p>Firma:</p><p class="firma"><img src="${firmaImg}" alt="Firma di ${nome}" style="max-width:100%"></p>` +
    `<p class="data">Documento firmato digitalmente il ${data}. Progetto ToothTalk.</p></body></html>`;

  const { randomUUID } = await import("node:crypto");
  const buffer = Buffer.from(html, "utf8");
  const sha256 = (await import("node:crypto")).createHash("sha256").update(buffer).digest("hex");
  const fileName = `liberatoria_${nome.replace(/\s+/g, "_").slice(0, 40)}.html`;
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
    contentType: "text/html; charset=utf-8", upsert: false,
  });
  if (eUpload) return errore("Upload fallito: " + eUpload.message);

  const { data: versione, error: eVers } = await admin.from("deliverable_versions").insert({
    deliverable_id: deliverableId, origin: "originale", bucket: "finali",
    storage_path: storagePath, file_name: fileName, mime_type: "text/html; charset=utf-8",
    size_bytes: buffer.byteLength, sha256, uploaded_by: profilo.id,
  }).select("id").single<{ id: string }>();
  if (eVers) {
    await admin.storage.from("finali").remove([storagePath]).catch(() => {});
    return errore("Registrazione fallita: " + eVers.message);
  }

  const { error: eReg } = await admin.rpc("registra_upload_liberatoria", {
    p_token: token, p_version: versione.id, p_metodo: "canvas",
  });
  if (eReg) return errore("Token non valido o gia usato: " + eReg.message);

  // Conferma al firmatario: se ha PEC, riceverà la PEC di sigillo.
  // Se ha solo email, gli mandiamo subito una ricevuta con l'impronta.
  if (!haPec) {
    // Il contatto non ha PEC: inviamo conferma via email ordinaria
    try {
      await inviaConfermaFirma(td?.contatto_esterno_email || "", nome, sha256);
    } catch { /* best-effort */ }
  }

  return { ok: true };
}

async function inviaConfermaFirma(destinatario: string, nome: string, sha256: string) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });
  await t.sendMail({
    from: process.env.MAIL_USER,
    to: destinatario,
    subject: "Conferma liberatoria — ToothTalk",
    text: `Gentile ${nome},\n\n` +
      `Hai firmato la liberatoria per il progetto ToothTalk.\n` +
      `Il documento è stato registrato con impronta SHA256:\n${sha256}\n\n` +
      `Questa impronta identifica in modo univoco il contenuto che hai firmato ` +
      `e sarà certificata via PEC al momento della pubblicazione del video.\n\n` +
      `— ToothTalk`,
  });
}

// ------------------------------------------------------------------ OTP

/** Invia un codice OTP di 6 cifre all'email del contatto. */
export async function richiediOtpLiberatoria(
  token: string,
  nome: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const admin = supabaseAdmin();

  const { data: richiesta, error: eTok } = await admin
    .rpc("verifica_token_liberatoria", { p_token: token });
  if (eTok || !richiesta?.length) return errore("Token non valido o scaduto.");

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const { createHash } = await import("node:crypto");
  const otpHash = createHash("sha256").update(otp).digest("hex");

  const { error: eUp } = await admin.from("richieste_liberatoria")
    .update({ otp_hash: otpHash, otp_generato_at: new Date().toISOString() })
    .eq("token", token);
  if (eUp) return errore("Impossibile registrare il codice.");

  const contattoEmail = richiesta[0].contatto_email as string;
  try { await inviaEmailOtp(contattoEmail, nome, otp); } catch { /* best-effort */ }

  return { ok: true };
}

/** Verifica l'OTP, genera il documento firmato e archivia tutto. */
export async function firmaConOtpLiberatoria(
  token: string,
  nome: string,
  otp: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const admin = supabaseAdmin();

  const { data: richiesta, error: eTok } = await admin
    .from("richieste_liberatoria")
    .select("task_id, contatto_email, otp_hash, otp_generato_at")
    .eq("token", token).eq("stato", "inviata")
    .single<{ task_id: string; contatto_email: string; otp_hash: string | null; otp_generato_at: string | null }>();

  if (eTok || !richiesta) return errore("Token non valido o scaduto.");
  if (!richiesta.otp_hash) return errore("Nessun codice OTP richiesto.");

  const generato = new Date(richiesta.otp_generato_at!).getTime();
  if (Date.now() - generato > 10 * 60 * 1000) return errore("Codice scaduto. Richiedine uno nuovo.");

  const { createHash } = await import("node:crypto");
  const otpHash = createHash("sha256").update(otp).digest("hex");
  if (otpHash !== richiesta.otp_hash) return errore("Codice non valido.");

  const taskId = richiesta.task_id;
  const data = new Date().toISOString().slice(0, 10);
  const html =
    `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Liberatoria — ToothTalk</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#1e293b}` +
    `h1{font-size:1.2em;margin-bottom:.5em}.data{color:#64748b;font-size:.85em;margin-top:2em}</style></head><body>` +
    `<img src="https://toothtalk.it/logo-toothtalk.svg" style="height:36px" alt="ToothTalk"><h1>Liberatoria privacy / immagine</h1>` +
    `<p>Il/La sottoscritto/a <strong>${nome}</strong> autorizza il progetto <strong>ToothTalk</strong> ` +
    `a riprendere e pubblicare la propria immagine e voce nel video per il quale è stato/a intervistato/a.</p>` +
    `<p>Firmato digitalmente tramite codice OTP verificato il ${data}.</p>` +
    `<p class="data">Documento certificato. Progetto ToothTalk.</p></body></html>`;


  const { randomUUID } = await import("node:crypto");
  const buffer = Buffer.from(html, "utf8");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const fileName = `liberatoria_${nome.replace(/\s+/g, "_").slice(0, 40)}.html`;
  const storagePath = `${taskId}/finale_liberatoria/${randomUUID()}__${fileName}`;

  const { data: del } = await admin.from("deliverables").select("id")
    .eq("task_id", taskId).eq("kind", "finale_liberatoria").single<{ id: string }>();
  let deliverableId: string;
  if (!del) {
    const { data: nuovo } = await admin.from("deliverables")
      .insert({ task_id: taskId, kind: "finale_liberatoria", created_by: null })
      .select("id").single<{ id: string }>();
    if (!nuovo) return errore("Impossibile creare lo slot.");
    deliverableId = nuovo.id;
  } else { deliverableId = del.id; }

  const { data: profilo } = await admin.from("profiles").select("id")
    .eq("role", "admin").eq("attivo", true).limit(1).single<{ id: string }>();
  if (!profilo) return errore("Nessun admin trovato.");

  const { error: eUpload } = await admin.storage.from("finali").upload(storagePath, buffer, {
    contentType: "text/html; charset=utf-8", upsert: false,
  });
  if (eUpload) return errore("Upload fallito: " + eUpload.message);

  const { data: versione } = await admin.from("deliverable_versions").insert({
    deliverable_id: deliverableId, origin: "originale", bucket: "finali",
    storage_path: storagePath, file_name: fileName, mime_type: "text/html; charset=utf-8",
    size_bytes: buffer.byteLength, sha256, uploaded_by: profilo.id,
  }).select("id").single<{ id: string }>();
  if (!versione) { await admin.storage.from("finali").remove([storagePath]).catch(() => {}); return errore("Registrazione fallita."); }

  const { error: eReg } = await admin.rpc("registra_upload_liberatoria", {
    p_token: token, p_version: versione.id, p_metodo: "otp",
  });
  if (eReg) return errore("Token non valido o gia usato.");

  const { data: td } = await admin.from("tasks")
    .select("contatto_esterno_pec").eq("id", taskId)
    .single<{ contatto_esterno_pec: string | null }>();
  if (!td?.contatto_esterno_pec) {
    try { await inviaConfermaFirma(richiesta.contatto_email, nome, sha256); } catch { /* best-effort */ }
  }

  return { ok: true };
}

async function inviaEmailOtp(destinatario: string, nome: string, otp: string) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });
  await t.sendMail({
    from: process.env.MAIL_USER, to: destinatario,
    subject: "Codice di firma — ToothTalk",
    text: `Gentile ${nome},\n\nIl tuo codice per firmare la liberatoria è:\n\n  ${otp}\n\n` +
      `Inseriscilo nella pagina che hai aperto. Valido 10 minuti.\n\n— ToothTalk`,
  });
}


