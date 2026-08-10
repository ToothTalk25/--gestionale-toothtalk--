"use server";

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
 * Elimina un account e tutti i dati personali trasmessi (diritto all'oblio).
 *
 * Cosa viene eliminato:
 *  - l'accordo firmato (file) e la foto dal profilo
 *  - i consensi GDPR e le appartenenze ai gruppi
 *  - i materiali di lavorazione trasmessi dalla persona (bucket originali)
 *  - i dati anagrafici e l'accesso (attivo=false, non può più entrare)
 *
 * Resta a registro solo l'archivio CERTIFICATO (impronte, verbali, PEC):
 * la legge consente di conservare ciò che serve alla tutela di diritti, e
 * le copie PEC sono comunque già nelle caselle. Il profilo diventa
 * "Ex partecipante", senza dati personali.
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

  // 1. File personali (accordo e foto)
  const { data: profilo } = await admin
    .from("profiles")
    .select("id, foto_path, accordo_path")
    .eq("id", userId)
    .single<{ id: string; foto_path: string | null; accordo_path: string | null }>();
  if (profilo?.foto_path) {
    await admin.storage.from("profili").remove([profilo.foto_path]).catch(() => {});
  }
  if (profilo?.accordo_path) {
    await admin.storage.from("profili").remove([profilo.accordo_path]).catch(() => {});
  }

  // 2. Consensi e appartenenze
  await ignora(admin.from("consensi").delete().eq("user_id", userId));
  await ignora(admin.from("memberships").delete().eq("user_id", userId));

  // 3. Materiali di lavorazione trasmessi (bucket originali), non certificati
  const { data: deliverables } = await admin
    .from("deliverables")
    .select("id")
    .eq("created_by", userId);
  for (const d of deliverables ?? []) {
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

  // 4. Anonimizzazione del profilo (diritto all'oblio) — l'archivio
  //    certificato resta con riferimenti validi ma senza dati personali.
  await admin
    .from("profiles")
    .update({
      email: `ex-${userId.slice(0, 8)}@toothtalk.local`,
      full_name: "Ex partecipante",
      pec: null,
      universita: null,
      foto_path: null,
      accordo_path: null,
      accordo_sha256: null,
      accordo_caricato_at: null,
      accordo_verificato: null,
      accordo_verifica_note: null,
      accordo_verificato_at: null,
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

export async function aggiornaAnagrafica(campi: CampiAnagrafica): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // La PEC, se cambia, deve essere quella dell'ateneo del proprio gruppo.
  if (campi.pec) {
    const { data: poli } = await supabase
      .from("memberships")
      .select("polo_id")
      .eq("user_id", profile.id)
      .returns<{ polo_id: string }[]>();
    const polo = poli?.[0]?.polo_id;
    if (!polo) {
      return errore("Non appartieni a nessun gruppo: impossibile verificare la PEC.");
    }
    const { data: pecOk } = await supabase.rpc("pec_universitaria_valida", {
      p_polo: polo,
      p_pec: campi.pec,
    });
    if (pecOk === false) {
      return errore(
        "La PEC non appartiene al dominio universitario del tuo gruppo. " +
          "Usa la PEC rilasciata dal tuo ateneo.",
      );
    }
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

  const { error } = await supabase
    .from("profiles")
    .update({ foto_path: storagePath })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  revalidatePath("/profilo");
  return { ok: true, dati: undefined };
}

/** Registra il consenso GDPR (privacy o cookie) per l'utente corrente. */
export async function registraConsenso(tipo: "privacy" | "cookie"): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const versione = tipo === "privacy" ? PRIVACY_VERSION : COOKIE_VERSION;
  const { error } = await supabase.from("consensi").insert({
    user_id: profile.id,
    tipo,
    versione,
  });
  if (error) return errore(error.message);

  revalidatePath("/");
  return { ok: true, dati: undefined };
}

/**
 * Registra l'accordo editoriale caricato e lo spedisce subito via PEC a chi
 * ha accesso globale, con copia al partecipante sulla sua casella. È il
 * meccanismo che costruisce il registro dei partecipanti per sede.
 */
export async function caricaAccordo(
  storagePath: string,
  sha256: string,
): Promise<Esito<{ messageId: string; verifica: EsitoVerificaAccordo }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  if (!profile.pec) {
    return errore(
      "Prima di caricare l'accordo devi inserire la tua PEC nel profilo: è " +
        "necessaria per ricevere la copia certificata via PEC.",
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_path: storagePath,
      accordo_sha256: sha256,
      accordo_caricato_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  // --- PEC all'accesso globale -----------------------------------------
  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(
      e instanceof Error
        ? `Accordo salvato, ma la PEC non è configurata: ${e.message}`
        : "Accordo salvato, ma la PEC non è configurata.",
    );
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(storagePath);
  if (eBlob || !blob) {
    return errore("Accordo salvato ma PEC non partita: file non leggibile dallo storage.");
  }

  const nomeFile = storagePath.split("/").pop() ?? "accordo.pdf";
  const buffer = Buffer.from(await blob.arrayBuffer());
  const nome = profile.full_name ?? profile.email;

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
        `${nome} ha caricato il proprio accordo editoriale ToothTalk.`,
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
    <strong>${nome}</strong> ha caricato il proprio accordo editoriale ToothTalk.
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
      copiaConoscenza: [profile.pec],
    });

    revalidatePath("/profilo");
    return { ok: true, dati: { messageId, verifica } };
  } catch (e) {
    return errore(
      `Accordo salvato ma PEC non partita: ${e instanceof Error ? e.message : "errore di spedizione"}`,
    );
  }
}
