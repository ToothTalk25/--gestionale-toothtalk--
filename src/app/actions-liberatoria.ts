"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { nettizzaDestinatario, validaEmail } from "@/lib/mail";

function errore(msg: string): { ok: false; errore: string } {
  return { ok: false, errore: msg };
}

/**
 * Registra il documento firmato nel registro granulare consents_and_releases
 * (GDPR Art. 5, 6, 7). Append-only: la riga resta, la revoca si marca.
 * Best-effort: la firma è già archiviata e tracciata nelle tabelle
 * richieste_liberatoria/deliverable_versions; questo è un indice granulare
 * di consultazione, quindi un errore qui non blocca mai il flusso.
 */
async function registraNelRegistroConsensi(params: {
  admin: ReturnType<typeof supabaseAdmin>;
  taskId: string;
  richiestaId?: string;
  tipoSoggetto: "maggiorenne" | "minore" | "collaboratore";
  nome: string;
  email?: string | null;
  storagePath: string;
  sha256: string;
  metodo: "otp" | "canvas" | "upload_manuale";
}): Promise<void> {
  try {
    let richiestaId: string | null = params.richiestaId ?? null;
    if (!richiestaId) {
      const { data } = await params.admin
        .from("richieste_liberatoria")
        .select("id")
        .eq("task_id", params.taskId)
        .order("creato_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string }>();
      richiestaId = data?.id ?? null;
    }

    await params.admin.from("consents_and_releases").insert({
      task_id: params.taskId,
      richiesta_id: richiestaId,
      tipo_soggetto: params.tipoSoggetto,
      tipo: "liberatoria",
      nome_soggetto: params.nome,
      email_soggetto: params.email ?? null,
      storage_path: params.storagePath,
      sha256: params.sha256,
      metodo_firma: params.metodo,
      firmato_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Registrazione consents_and_releases fallita (ignorata):", e);
  }
}

// ------------------------------------------------------------------ email

type EsitoInvioLink =
  | { ok: true; via: "pec" | "email"; destinatario: string }
  | { ok: false; via: "pec" | "email"; destinatario: string; errore: string };

/**
 * Invia il link di firma su un canale preciso. Non inghiotte MAI un
 * fallimento: credenziali assenti, SMTP che rifiuta (es. 535 EAUTH), rete
 * giù — tutto torna come { ok:false, errore } (e viene loggato), così il
 * chiamante può mostrarlo all'admin e ripiegare sul canale alternativo.
 */
async function inviaLink(
  destinatario: string,
  token: string,
  via: "pec" | "email",
): Promise<EsitoInvioLink> {
  const to = nettizzaDestinatario(destinatario);
  if (!validaEmail(to)) {
    return { ok: false, via, destinatario: to, errore: "Destinatario non valido." };
  }
  const link = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/carica-liberatoria?token=${token}`;
  // Il testo semplice resta come fallback per i client che non mostrano
  // HTML; il bottone evita di esporre il link grezzo (con il token) a vista.
  const html =
    `<div style="max-width:480px;margin:0 auto;font-family:system-ui,sans-serif;padding:20px;color:#1e293b">` +
    `<p>Salve,</p>` +
    `<p>Lei compare in un video del progetto ToothTalk. Può compilare e firmare la liberatoria cliccando qui sotto:</p>` +
    `<a href="${link}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Firma la liberatoria</a>` +
    `<p style="color:#64748b;font-size:.85em;margin-top:32px">Il link è valido 7 giorni.<br>— ToothTalk™</p>` +
    `</div>`;

  try {
    const nodemailer = await import("nodemailer");

    if (via === "pec") {
      // Via PEC: mittente toothtalk@pec.it, SMTP Aruba
      if (!process.env.PEC_USER || !process.env.PEC_PASSWORD) {
        return { ok: false, via, destinatario: to, errore: "PEC non configurata sul server (PEC_USER/PEC_PASSWORD)." };
      }
      const transporter = nodemailer.createTransport({
        host: process.env.PEC_HOST || "smtps.pec.aruba.it",
        port: Number(process.env.PEC_PORT || 465),
        secure: true,
        auth: { user: process.env.PEC_USER, pass: process.env.PEC_PASSWORD },
      });
      await transporter.sendMail({
        from: `"ToothTalk™" <${process.env.PEC_MITTENTE || process.env.PEC_USER}>`,
        to,
        subject: "Liberatoria — ToothTalk™",
        text: `Salve,\n\nLei compare in un video del progetto ToothTalk. ` +
          `Può compilare e firmare la liberatoria a questo link:\n\n${link}\n\n` +
          `Il link è valido 7 giorni. Grazie.\n\n— ToothTalk™`,
        html,
      });
      return { ok: true, via, destinatario: to };
    }

    // Via Gmail
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      return { ok: false, via, destinatario: to, errore: "Email non configurata sul server (MAIL_USER/MAIL_PASS)." };
    }
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 587, secure: false,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
    await transporter.sendMail({
      from: `"ToothTalk™" <${process.env.MAIL_USER}>`,
      to,
      subject: "Liberatoria — ToothTalk™",
      text: `Salve,\n\nLei compare in un video del progetto ToothTalk. ` +
        `Può compilare e firmare la liberatoria a questo link:\n\n${link}\n\n` +
        `Il link è valido 7 giorni. Grazie.\n\n— ToothTalk™`,
      html,
    });
    return { ok: true, via, destinatario: to };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Invio link liberatoria via ${via} fallito:`, msg);
    return { ok: false, via, destinatario: to, errore: msg };
  }
}

// ------------------------------------------------------------------ azioni

/**
 * Crea la richiesta di liberatoria e la invia (via PEC se il contatto ne ha
 * una, altrimenti via email). Nessun controllo di ruolo qui dentro: chi può
 * chiamarla è deciso dalle funzioni pubbliche più sotto.
 */
type EsitoRichiestaLiberatoria =
  | {
      ok: true;
      token: string;
      inviatoVia: "pec" | "email";
      destinatario: string;
      avviso?: string;
    }
  | { ok: false; errore: string };

/**
 * Crea la richiesta di liberatoria e invia il link di firma.
 *
 * La scelta del canale (PEC se il contatto ne ha una, altrimenti email) e i
 * recapiti arrivano dai PARAMETRI, mai riletti dal database: un onBlur in
 * corsa o un valore non ancora salvato non possono far partire l'invio con
 * una PEC vecchia. Se l'invio via PEC fallisce (credenziali, SMTP, rete) si
 * ripiega automaticamente sull'email del contatto quando esiste — e se
 * anche lei fallisce, l'errore torna al chiamante invece di sparire.
 * Nessun controllo di ruolo qui dentro: chi può chiamarla è deciso dalle
 * funzioni pubbliche più sotto.
 */
async function creaEInviaRichiesta(
  taskId: string,
  contatto_email: string | null,
  contatto_pec: string | null,
): Promise<EsitoRichiestaLiberatoria> {
  const email = contatto_email ? nettizzaDestinatario(contatto_email) : "";
  const pec = contatto_pec ? nettizzaDestinatario(contatto_pec) : "";

  if (email && !validaEmail(email)) return errore("Indirizzo email non valido.");
  if (pec && !validaEmail(pec)) return errore("Indirizzo PEC non valido.");
  if (!email && !pec) return errore("Indica almeno un indirizzo email o PEC del contatto.");

  // L'insert avviene col service_role: la RLS richieste_admin_insert (0075)
  // accetta INSERT solo da admin, ma il chiamante reale è un Collaboratore
  // non-admin che compila il contatto al momento dell'intervista (Protocollo
  // Art. 4.2: la liberatoria parte da sola). Il controllo di chi può farlo
  // resta sulle RLS di tasks (is_member_of), non su questa insert.
  // contatto_email è NOT NULL: per un contatto solo-PEC conserva la PEC.
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("richieste_liberatoria")
    .insert({
      task_id: taskId,
      contatto_email: email || pec,
      scade_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("token")
    .single<{ token: string }>();

  if (error) return errore(error.message);

  if (pec) {
    const esitoPec = await inviaLink(pec, data.token, "pec");
    if (esitoPec.ok) {
      return { ok: true, token: data.token, inviatoVia: "pec", destinatario: pec };
    }

    // Fallback sull'email del contatto, se è un recapito distinto e valido.
    if (email && email !== pec) {
      const esitoEmail = await inviaLink(email, data.token, "email");
      if (esitoEmail.ok) {
        return {
          ok: true,
          token: data.token,
          inviatoVia: "email",
          destinatario: email,
          avviso: `Invio via PEC non riuscito (${esitoPec.errore}): il link è stato inviato via email a ${email}.`,
        };
      }
      return errore(
        `Invio via PEC non riuscito (${esitoPec.errore}). Anche il fallback via email è fallito (${esitoEmail.errore}).`,
      );
    }
    return errore(
      `Invio via PEC non riuscito: ${esitoPec.errore}. Nessun altro recapito email disponibile per il fallback.`,
    );
  }

  const esitoEmail = await inviaLink(email, data.token, "email");
  if (!esitoEmail.ok) return errore(`Invio email non riuscito: ${esitoEmail.errore}.`);
  return { ok: true, token: data.token, inviatoVia: "email", destinatario: email };
}

/**
 * Se il task coinvolge terzi, ha un contatto valido e NON ha già una
 * richiesta di liberatoria, la crea e la invia automaticamente — come
 * previsto dal Protocollo Operativo Art. 4.2 ("Il sistema genera
 * automaticamente il link OTP e invia la liberatoria all'indirizzo
 * indicato"): il Collaboratore non deve azionare nulla lui stesso.
 * Best-effort: un errore qui non deve mai bloccare il salvataggio del
 * contatto, quindi non propaga eccezioni.
 */
async function inviaAutomaticamenteSeNecessario(taskId: string): Promise<void> {
  try {
    const supabase = await supabaseServer();
    const { data: task } = await supabase
      .from("tasks")
      .select("coinvolge_terzi, contatto_esterno_email, contatto_esterno_pec")
      .eq("id", taskId)
      .single<{ coinvolge_terzi: boolean; contatto_esterno_email: string | null; contatto_esterno_pec: string | null }>();
    if (!task?.coinvolge_terzi) return;

    const contatto = task.contatto_esterno_pec?.trim() || task.contatto_esterno_email?.trim();
    if (!contatto) return;

    const { count } = await supabase
      .from("richieste_liberatoria")
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId);
    if (count && count > 0) return; // già inviata una volta: un reinvio è una scelta esplicita (bottone admin)

    const esito = await creaEInviaRichiesta(
      taskId,
      task.contatto_esterno_email?.trim() || null,
      task.contatto_esterno_pec?.trim() || null,
    );
    // Best-effort verso il contatto, ma il fallimento non deve sparire nel
    // vuoto: resta nei log per essere recuperato (i cron e il reinvio admin
    // ne tengono traccia).
    if (!esito.ok) console.error("Invio automatico liberatoria fallito:", esito.errore);
  } catch (e) {
    console.error("Invio automatico liberatoria fallito (ignorato):", e);
  }
}

/** Aggiorna l'email del contatto esterno per la liberatoria. */
export async function aggiornaContattoEsterno(
  taskId: string,
  contatto_esterno_email: string | null,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  if (contatto_esterno_email && contatto_esterno_email.trim() && !validaEmail(contatto_esterno_email)) {
    return errore("Indirizzo email non valido.");
  }
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("tasks")
    .update({ contatto_esterno_email })
    .eq("id", taskId);
  if (error) return errore(error.message);
  if (contatto_esterno_email?.trim()) await inviaAutomaticamenteSeNecessario(taskId);
  revalidatePath(`/task/${taskId}`);
  return { ok: true };
}

/** Aggiorna la PEC del contatto esterno per la liberatoria. */
export async function aggiornaContattoPec(
  taskId: string,
  contatto_esterno_pec: string | null,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  if (contatto_esterno_pec && contatto_esterno_pec.trim() && !validaEmail(contatto_esterno_pec)) {
    return errore("Indirizzo PEC non valido.");
  }
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("tasks")
    .update({ contatto_esterno_pec })
    .eq("id", taskId);
  if (error) return errore(error.message);
  if (contatto_esterno_pec?.trim()) await inviaAutomaticamenteSeNecessario(taskId);
  revalidatePath(`/task/${taskId}`);
  return { ok: true };
}

/**
 * Reinvio manuale della liberatoria (es. dopo un errore o una correzione
 * dell'indirizzo). Il primo invio, quello "automatico" previsto dal
 * Protocollo, parte da solo — vedi inviaAutomaticamenteSeNecessario sopra.
 * Riservato a chi ha accesso globale proprio perché è un reinvio fuori dal
 * flusso ordinario, non il passaggio normale del Collaboratore.
 */
export async function inviaRichiestaLiberatoria(
  taskId: string,
  contatto_email: string | null,
  contatto_pec: string | null,
): Promise<EsitoRichiestaLiberatoria> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Solo chi ha accesso globale può reinviare manualmente la richiesta.");

  const email = contatto_email ? nettizzaDestinatario(contatto_email) : "";
  const pec = contatto_pec ? nettizzaDestinatario(contatto_pec) : "";
  if (email && !validaEmail(email)) return errore("Indirizzo email non valido.");
  if (pec && !validaEmail(pec)) return errore("Indirizzo PEC non valido.");
  if (!email && !pec) return errore("Indica almeno un indirizzo email o PEC del contatto.");

  // Persiste SUBITO i recapiti passati dal form: l'invio che segue usa
  // esattamente questi valori, mai una PEC vecchia rimasta nel database
  // perché l'onBlur non era ancora arrivato o era fallito in silenzio.
  const supabase = await supabaseServer();
  const { error: eUp } = await supabase
    .from("tasks")
    .update({
      contatto_esterno_email: email || null,
      contatto_esterno_pec: pec || null,
    })
    .eq("id", taskId);
  if (eUp) return errore(eUp.message);

  const esito = await creaEInviaRichiesta(taskId, email || null, pec || null);
  revalidatePath(`/task/${taskId}`);
  return esito;
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
    `<img src="${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/logo-toothtalk.svg" class="logo" alt="ToothTalk"><h1>Liberatoria privacy / immagine</h1>` +
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

  // Registro granulare consents_and_releases (GDPR).
  const { data: richiestaRow } = await admin
    .from("richieste_liberatoria")
    .select("id, contatto_email")
    .eq("task_id", task_id)
    .eq("stato", "caricata")
    .order("caricato_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; contatto_email: string }>();
  await registraNelRegistroConsensi({
    admin, taskId: task_id, richiestaId: richiestaRow?.id ?? undefined,
    tipoSoggetto: "maggiorenne", nome,
    email: richiestaRow?.contatto_email ?? td?.contatto_esterno_email,
    storagePath, sha256, metodo: "canvas",
  });

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
  destinatario = nettizzaDestinatario(destinatario);
  if (!validaEmail(destinatario)) return;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });
  await t.sendMail({
    from: `"ToothTalk™" <${process.env.MAIL_USER}>`,
    to: destinatario,
    subject: "Conferma liberatoria — ToothTalk™",
    text: `Gentile ${nome},\n\n` +
      `Hai firmato la liberatoria per il progetto ToothTalk.\n` +
      `Il documento è stato registrato con impronta SHA256:\n${sha256}\n\n` +
      `Questa impronta identifica in modo univoco il contenuto che hai firmato ` +
      `e sarà certificata via PEC al momento della pubblicazione del video.\n\n` +
      `— ToothTalk™`,
    html:
      `<div style="max-width:480px;margin:0 auto;font-family:system-ui,sans-serif;padding:20px;color:#1e293b">` +
      `<p>Gentile ${nome},</p>` +
      `<p>Hai firmato la liberatoria per il progetto ToothTalk. Sarà certificata via PEC al momento della pubblicazione del video.</p>` +
      `<p style="color:#94a3b8;font-size:.75em;margin-top:32px;word-break:break-all">Impronta del documento firmato (identifica in modo univoco il contenuto): <span style="font-family:monospace">${sha256}</span></p>` +
      `<p style="color:#64748b;font-size:.85em;margin-top:16px">— ToothTalk™</p>` +
      `</div>`,
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

  // Un solo reinvio ogni 60 secondi: senza questo, il modulo pubblico (nessun
  // login) permetterebbe di spammare la casella del contatto a raffica.
  const { data: precedente } = await admin
    .from("richieste_liberatoria")
    .select("otp_generato_at")
    .eq("token", token)
    .single<{ otp_generato_at: string | null }>();
  if (precedente?.otp_generato_at) {
    const trascorsi = Date.now() - new Date(precedente.otp_generato_at).getTime();
    if (trascorsi < 60 * 1000) {
      return errore(`Attendi ${Math.ceil((60 * 1000 - trascorsi) / 1000)} secondi prima di richiedere un nuovo codice.`);
    }
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const { createHash } = await import("node:crypto");
  const otpHash = createHash("sha256").update(otp).digest("hex");

  const { error: eUp } = await admin.from("richieste_liberatoria")
    .update({ otp_hash: otpHash, otp_generato_at: new Date().toISOString(), otp_tentativi: 0 })
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
    .select("task_id, contatto_email, otp_hash, otp_generato_at, otp_tentativi")
    .eq("token", token).eq("stato", "inviata")
    .single<{
      task_id: string; contatto_email: string; otp_hash: string | null;
      otp_generato_at: string | null; otp_tentativi: number;
    }>();

  if (eTok || !richiesta) return errore("Token non valido o scaduto.");
  if (!richiesta.otp_hash) return errore("Nessun codice OTP richiesto.");

  const generato = new Date(richiesta.otp_generato_at!).getTime();
  if (Date.now() - generato > 10 * 60 * 1000) return errore("Codice scaduto. Richiedine uno nuovo.");

  // Al massimo 5 tentativi per ogni codice: oltre, va richiesto un codice
  // nuovo — impedisce di provare a forza bruta le 6 cifre (1 su 1.000.000).
  if (richiesta.otp_tentativi >= 5) {
    return errore("Troppi tentativi con questo codice. Richiedi un nuovo codice.");
  }

  const { createHash, timingSafeEqual } = await import("node:crypto");
  // Confronto timing-safe: la lunghezza è nota (64 byte esadecimali) e i due
  // digest vengono confrontati in tempo costante, senza cortocircuitare.
  const candidato = createHash("sha256").update(otp).digest();
  const atteso = Buffer.from(richiesta.otp_hash ?? "", "hex");
  const valido = atteso.length === candidato.length && timingSafeEqual(atteso, candidato);
  if (!valido) {
    await admin.from("richieste_liberatoria")
      .update({ otp_tentativi: richiesta.otp_tentativi + 1 })
      .eq("token", token);
    return errore("Codice non valido.");
  }

  const taskId = richiesta.task_id;
  const data = new Date().toISOString().slice(0, 10);
  const html =
    `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Liberatoria — ToothTalk</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#1e293b}` +
    `h1{font-size:1.2em;margin-bottom:.5em}.data{color:#64748b;font-size:.85em;margin-top:2em}</style></head><body>` +
    `<img src="${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/logo-toothtalk.svg" style="height:36px" alt="ToothTalk"><h1>Liberatoria privacy / immagine</h1>` +
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
  if (eReg) {
    // Persa la corsa (token già usato da una richiesta concorrente, o stato
    // non più "inviata"): il documento appena creato non deve restare
    // orfano — lo si rimuove (riga di registro e file) prima di rispondere.
    try {
      await admin.from("deliverable_versions").delete().eq("id", versione.id);
    } catch {
      // best-effort: la pulizia non deve mai cambiare l'esito della firma
    }
    await admin.storage.from("finali").remove([storagePath]).catch(() => {});
    return errore("Token non valido o gia usato.");
  }

  // Registro granulare consents_and_releases (GDPR).
  await registraNelRegistroConsensi({
    admin, taskId, tipoSoggetto: "maggiorenne", nome,
    email: richiesta.contatto_email,
    storagePath, sha256, metodo: "otp",
  });

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
  destinatario = nettizzaDestinatario(destinatario);
  if (!validaEmail(destinatario)) return;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });
  await t.sendMail({
    from: `"ToothTalk™" <${process.env.MAIL_USER}>`, to: destinatario,
    subject: "Codice di firma — ToothTalk™",
    text: `Gentile ${nome},\n\nIl tuo codice per firmare la liberatoria è:\n\n  ${otp}\n\n` +
      `Inseriscilo nella pagina che hai aperto. Valido 10 minuti.\n\n— ToothTalk™`,
  });
}


