"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { leggiConfigPec, spedisciPec } from "@/lib/pec";
import { verificaAccordoFirmato, type EsitoVerificaAccordo } from "@/lib/gemini";
import { COOKIE_VERSION, PRIVACY_VERSION, type Profile } from "@/lib/types";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function errore(msg: string): Esito<never> {
  return { ok: false, errore: msg };
}

type CampiAnagrafica = Partial<Pick<Profile, "universita" | "pec">>;

/** Aggiorna i dati anagrafici del proprio profilo. */
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
