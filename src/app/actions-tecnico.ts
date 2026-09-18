"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { leggiConfigPec, spedisciPec } from "@/lib/pec";

/**
 * Server actions per la pagina admin del Collaboratore Tecnico (Documento
 * 5). Opzione B (vedi note-legali/PROMPT_claude_code_rinnovo_tecnico_invio_automatico.md):
 * nessun profilo applicativo — anagrafica, registro accessi (Allegato 1) e
 * rinnovo gestiti qui direttamente dall'accesso globale.
 */

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function errore(msg: string): Esito<never> {
  return { ok: false, errore: msg };
}

async function ignora(p: PromiseLike<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    // best-effort: un log mancato non deve mai bloccare l'operazione vera
  }
}

function sanifica(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Toglie il prefisso uuid__ che lo storage antepone: è interno, non deve arrivare a chi riceve il documento. */
function nomeFileUmano(path: string): string {
  const nome = path.split("/").pop() ?? "documento.pdf";
  return nome.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i, "");
}

/** Stessa formula di scadenzaTraMesi in actions-profilo.ts (Art. 9 dell'Accordo). */
function scadenzaTraMesi(mesi: number, adesso = new Date()): string {
  const giorno = adesso.getUTCDate();
  const anno = adesso.getUTCFullYear();
  const mese = adesso.getUTCMonth() + mesi;
  const ultimoGiorno = new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anno, mese, Math.min(giorno, ultimoGiorno))).toISOString().slice(0, 10);
}

export type AccessoTecnico = {
  id: string;
  collaboratore_tecnico_id: string;
  sistema: string;
  livello: string;
  concesso_il: string;
  revocato_il: string | null;
  note: string | null;
};

export type CollaboratoreTecnico = {
  id: string;
  nome: string;
  contatto: string;
  documento5_sottoscritto_il: string | null;
  accordo_path: string | null;
  accordo_sha256: string | null;
  accordo_scadenza: string | null;
  rinnovo_path: string | null;
  rinnovo_sha256: string | null;
  rinnovo_caricato_at: string | null;
  rinnovo_approvato_admin_at: string | null;
  attivo: boolean;
  created_at: string;
  collaboratori_tecnici_accessi: AccessoTecnico[];
};

export async function elencaCollaboratoriTecnici(): Promise<Esito<CollaboratoreTecnico[]>> {
  await requireAdmin();
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("collaboratori_tecnici")
    .select("*, collaboratori_tecnici_accessi(*)")
    .order("nome")
    .returns<CollaboratoreTecnico[]>();
  if (error) return errore(error.message);
  return { ok: true, dati: data ?? [] };
}

export async function creaCollaboratoreTecnico(input: {
  nome: string;
  contatto: string;
  documento5SottoscrittoIl: string | null;
  accordoSha256: string | null;
  accordoScadenza: string | null;
}): Promise<Esito<{ id: string }>> {
  const { profile } = await requireAdmin();
  if (!input.nome.trim()) return errore("Il nome è obbligatorio.");
  if (!input.contatto.trim()) return errore("Il contatto (email o PEC) è obbligatorio.");

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("collaboratori_tecnici")
    .insert({
      nome: input.nome.trim(),
      contatto: input.contatto.trim(),
      documento5_sottoscritto_il: input.documento5SottoscrittoIl,
      accordo_sha256: input.accordoSha256,
      accordo_scadenza: input.accordoScadenza,
      created_by: profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return errore(error?.message ?? "Creazione non riuscita.");

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "collaboratore_tecnico_creato",
      entity_type: "collaboratore_tecnico",
      entity_id: data.id,
      meta: { nome: input.nome, contatto: input.contatto },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: { id: data.id } };
}

export async function aggiornaCollaboratoreTecnico(
  id: string,
  campi: Partial<{
    nome: string;
    contatto: string;
    documento5_sottoscritto_il: string | null;
    accordo_sha256: string | null;
    accordo_scadenza: string | null;
    attivo: boolean;
  }>,
): Promise<Esito> {
  const { profile } = await requireAdmin();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("collaboratori_tecnici").update(campi).eq("id", id);
  if (error) return errore(error.message);

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "collaboratore_tecnico_aggiornato",
      entity_type: "collaboratore_tecnico",
      entity_id: id,
      meta: { campi },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: undefined };
}

/** Registra un nuovo accesso concesso — riga dell'Allegato 1 digitale. */
export async function aggiungiAccessoTecnico(
  collaboratoreTecnicoId: string,
  input: { sistema: string; livello: string; concessoIl: string; note?: string },
): Promise<Esito<{ id: string }>> {
  const { profile } = await requireAdmin();
  if (!input.sistema.trim() || !input.livello.trim()) {
    return errore("Sistema e livello sono obbligatori.");
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("collaboratori_tecnici_accessi")
    .insert({
      collaboratore_tecnico_id: collaboratoreTecnicoId,
      sistema: input.sistema.trim(),
      livello: input.livello.trim(),
      concesso_il: input.concessoIl,
      note: input.note?.trim() || null,
      created_by: profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return errore(error?.message ?? "Registrazione non riuscita.");

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "accesso_tecnico_concesso",
      entity_type: "collaboratore_tecnico_accesso",
      entity_id: data.id,
      meta: { collaboratore_tecnico_id: collaboratoreTecnicoId, ...input },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: { id: data.id } };
}

/** Corregge una riga del registro accessi, o la chiude impostando revocato_il. */
export async function aggiornaAccessoTecnico(
  accessoId: string,
  campi: Partial<{ sistema: string; livello: string; concesso_il: string; revocato_il: string | null; note: string | null }>,
): Promise<Esito> {
  const { profile } = await requireAdmin();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("collaboratori_tecnici_accessi").update(campi).eq("id", accessoId);
  if (error) return errore(error.message);

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: campi.revocato_il !== undefined ? "accesso_tecnico_revocato" : "accesso_tecnico_modificato",
      entity_type: "collaboratore_tecnico_accesso",
      entity_id: accessoId,
      meta: { campi },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: undefined };
}

/**
 * Prepara l'upload della scansione firmata del Documento 5 iniziale.
 * L'impronta che conta è quella che il server ricalcola su QUESTO file
 * (vedi caricaAccordoTecnico): un valore digitato a mano non è verificabile
 * in un secondo momento, quindi non basta a dare valore legale all'aggancio
 * hash con il Documento 5bis.
 */
export async function preparaUploadAccordoTecnico(
  collaboratoreTecnicoId: string,
  fileName: string,
): Promise<Esito<{ bucket: string; path: string; signedUrl: string; token: string }>> {
  await requireAdmin();
  const path = `tecnico/${collaboratoreTecnicoId}/accordo/${randomUUID()}__${sanifica(fileName)}`;
  const admin = supabaseAdmin();
  const { data: firma, error } = await admin.storage.from("finali").createSignedUploadUrl(path);
  if (error || !firma) return errore("Impossibile preparare il caricamento.");
  return { ok: true, dati: { bucket: "finali", path, signedUrl: firma.signedUrl, token: firma.token } };
}

/** Ricalcola l'impronta SERVER-SIDE sulla scansione appena caricata e la registra come quella verificata. */
export async function caricaAccordoTecnico(
  collaboratoreTecnicoId: string,
  storagePath: string,
): Promise<Esito<{ sha256: string }>> {
  const { profile } = await requireAdmin();
  if (!storagePath.startsWith(`tecnico/${collaboratoreTecnicoId}/accordo/`)) {
    return errore("Percorso del file non valido.");
  }

  const admin = supabaseAdmin();
  const { data: blob, error: eBlob } = await admin.storage.from("finali").download(storagePath);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error } = await admin
    .from("collaboratori_tecnici")
    .update({ accordo_path: storagePath, accordo_sha256: sha256 })
    .eq("id", collaboratoreTecnicoId);
  if (error) return errore(error.message);

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "accordo_tecnico_scansione_caricata",
      entity_type: "collaboratore_tecnico",
      entity_id: collaboratoreTecnicoId,
      meta: { sha256 },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: { sha256 } };
}

/** Prepara l'upload del documento di rinnovo firmato (Enrico lo carica per conto del Collaboratore Tecnico, Opzione B). */
export async function preparaUploadRinnovoTecnico(
  collaboratoreTecnicoId: string,
  fileName: string,
): Promise<Esito<{ bucket: string; path: string; signedUrl: string; token: string }>> {
  await requireAdmin();
  const path = `tecnico/${collaboratoreTecnicoId}/rinnovo/${randomUUID()}__${sanifica(fileName)}`;
  const admin = supabaseAdmin();
  const { data: firma, error } = await admin.storage.from("finali").createSignedUploadUrl(path);
  if (error || !firma) return errore("Impossibile preparare il caricamento.");
  return { ok: true, dati: { bucket: "finali", path, signedUrl: firma.signedUrl, token: firma.token } };
}

/** Registra il rinnovo caricato, in attesa di approvazione. */
export async function caricaRinnovoTecnico(
  collaboratoreTecnicoId: string,
  storagePath: string,
): Promise<Esito<{ sha256: string }>> {
  const { profile } = await requireAdmin();
  if (!storagePath.startsWith(`tecnico/${collaboratoreTecnicoId}/rinnovo/`)) {
    return errore("Percorso del file non valido.");
  }

  const admin = supabaseAdmin();
  const { data: blob, error: eBlob } = await admin.storage.from("finali").download(storagePath);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error } = await admin
    .from("collaboratori_tecnici")
    .update({
      rinnovo_path: storagePath,
      rinnovo_sha256: sha256,
      rinnovo_caricato_at: new Date().toISOString(),
    })
    .eq("id", collaboratoreTecnicoId);
  if (error) return errore(error.message);

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "rinnovo_tecnico_caricato",
      entity_type: "collaboratore_tecnico",
      entity_id: collaboratoreTecnicoId,
      meta: { sha256 },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: { sha256 } };
}

/**
 * Approva il rinnovo caricato: ricalcola l'hash server-side (mai fidarsi di
 * quello già salvato al momento dell'upload), sposta accordo_scadenza di 6
 * mesi dalla data di approvazione, e manda PEC/email al Collaboratore
 * Tecnico con il documento approvato allegato — stesso schema di
 * caricaControfirmaAccordo in actions-profilo.ts. Traccia in audit_log.
 */
export async function approvaRinnovoTecnico(
  collaboratoreTecnicoId: string,
): Promise<Esito<{ approvatoAt: string; nuovaScadenza: string }>> {
  const { profile } = await requireAdmin();

  const admin = supabaseAdmin();
  const { data: target } = await admin
    .from("collaboratori_tecnici")
    .select("id, nome, contatto, rinnovo_path, rinnovo_caricato_at")
    .eq("id", collaboratoreTecnicoId)
    .single<{
      id: string;
      nome: string;
      contatto: string;
      rinnovo_path: string | null;
      rinnovo_caricato_at: string | null;
    }>();
  if (!target) return errore("Collaboratore Tecnico non trovato.");
  if (!target.rinnovo_path) return errore("Nessun documento di rinnovo caricato.");

  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(e instanceof Error ? e.message : "PEC non configurata.");
  }

  const { data: blob, error: eBlob } = await admin.storage.from("finali").download(target.rinnovo_path);
  if (eBlob || !blob) return errore("File di rinnovo non leggibile dallo storage.");
  const buffer = Buffer.from(await blob.arrayBuffer());
  // Impronta ricalcolata ORA sul file davvero in storage: mai fidarsi di
  // quella salvata al momento dell'upload (stesso principio di caricaAccordo).
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const nomeFile = nomeFileUmano(target.rinnovo_path);

  const ora = new Date().toISOString();
  const nuovaScadenza = scadenzaTraMesi(6);

  const { error } = await admin
    .from("collaboratori_tecnici")
    .update({
      rinnovo_approvato_admin_at: ora,
      rinnovo_approvato_da: profile.id,
      accordo_scadenza: nuovaScadenza,
      accordo_sha256: sha256,
      rinnovo_path: null,
      rinnovo_sha256: null,
      rinnovo_caricato_at: null,
    })
    .eq("id", collaboratoreTecnicoId);
  if (error) return errore(error.message);

  try {
    await spedisciPec({
      config,
      oggetto: `[ToothTalk] Rinnovo Accordo Collaboratore Tecnico approvato — ${target.nome}`,
      testo: [
        "",
        `Ciao ${target.nome}!`,
        "",
        "Il tuo rinnovo dell'Accordo Collaboratore Tecnico è stato approvato:",
        `la nuova scadenza è il ${nuovaScadenza.replaceAll("-", "/")}.`,
        "",
        "In allegato trovi il documento di rinnovo così come approvato.",
        "",
        "Impronta SHA-256 del file:",
        `  ${sha256}`,
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk™</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Rinnovo Accordo Collaboratore Tecnico approvato</h1>
  <p style="font-size:13px;line-height:1.6">
    Ciao <strong>${target.nome}</strong>! Il tuo rinnovo è stato approvato: la nuova scadenza
    è il <strong>${nuovaScadenza.replaceAll("-", "/")}</strong>. In allegato il documento di
    rinnovo così come approvato.
  </p>
  <p style="font-size:12px;color:#666">Impronta SHA-256: <span style="font-family:monospace">${sha256}</span></p>
  <p style="font-size:11px;color:#999">Messaggio generato automaticamente dal gestionale ToothTalk.</p>
</div>`,
      allegati: [{ filename: nomeFile, content: buffer, contentType: blob.type || "application/pdf" }],
      destinatari: [target.contatto],
      copiaConoscenza: config.destinatari,
    });
  } catch (e) {
    return errore(
      `Rinnovo approvato ma PEC non partita: ${e instanceof Error ? e.message : "errore di spedizione"}`,
    );
  }

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "rinnovo_tecnico_approvato",
      entity_type: "collaboratore_tecnico",
      entity_id: collaboratoreTecnicoId,
      meta: {
        nome: target.nome,
        rinnovo_caricato_at: target.rinnovo_caricato_at,
        nuova_scadenza: nuovaScadenza,
        approvato_at: ora,
      },
    }),
  );

  revalidatePath("/admin/tecnico");
  return { ok: true, dati: { approvatoAt: ora, nuovaScadenza } };
}
