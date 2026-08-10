"use server";

import { createHash } from "node:crypto";
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
 * Elimina l'account e i dati personali "inutili" alla difesa del progetto.
 *
 * Viene eliminato:
 *  - la foto del profilo
 *  - i consensi GDPR e le appartenenze ai gruppi
 *  - il VIDEO GREZZO trasmesso (immagine/voce) dal bucket di lavorazione
 *  - i dati di contatto e anagrafici, e l'accesso (attivo=false)
 *
 * Viene CONSERVATO (tutela legale):
 *  - l'accordo firmato, con la cessione di proprietà del contenuto
 *  - script, copertina e descrizione (già certificati via PEC)
 *  - l'archivio certificato e le copie PEC, immutabili per legge
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

  // 1. Foto del profilo (l'accordo resta: è il titolo della cessione di proprietà)
  const { data: profilo } = await admin
    .from("profiles")
    .select("id, foto_path, accordo_path")
    .eq("id", userId)
    .single<{ id: string; foto_path: string | null; accordo_path: string | null }>();
  if (profilo?.foto_path) {
    await admin.storage.from("profili").remove([profilo.foto_path]).catch(() => {});
  }

  // 2. Consensi e appartenenze
  await ignora(admin.from("consensi").delete().eq("user_id", userId));
  await ignora(admin.from("memberships").delete().eq("user_id", userId));

  // 3. Solo il VIDEO GREZZO trasmesso (immagine/voce) viene distrutto.
  //    Script, copertina e materiali testuali restano: sono già certificati
  //    via PEC e servono alla difesa del progetto.
  const { data: deliverables } = await admin
    .from("deliverables")
    .select("id, kind")
    .eq("created_by", userId);
  for (const d of deliverables ?? []) {
    if (d.kind !== "video_grezzo") continue;
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

  // 4. Anonimizzazione dei dati personali del profilo. L'accordo resta
  //    (cessione di proprietà); foto e contatti vengono rimossi.
  await admin
    .from("profiles")
    .update({
      email: `ex-${userId.slice(0, 8)}@toothtalk.local`,
      full_name: "Ex partecipante",
      pec: null,
      universita: null,
      foto_path: null,
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

  // La PEC, se cambia, deve essere una PEC vera — non importa di chi: solo
  // non può essere una casella di posta gratuita, che una PEC non può
  // essere per definizione.
  if (campi.pec) {
    const { data: pecOk } = await supabase.rpc("pec_universitaria_valida", {
      p_polo: null,
      p_pec: campi.pec,
    });
    if (pecOk === false) {
      return errore(
        "Questo indirizzo sembra una casella email gratuita, non una PEC. " +
          "Inserisci una PEC vera: può essere tua, di un familiare o " +
          "condivisa — non deve necessariamente essere dell'università.",
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

  if (!storagePath.startsWith(`${profile.id}/foto/`)) {
    return errore("Percorso del file non valido.");
  }

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
  _sha256Client: string,
): Promise<Esito<{ messageId: string; verifica: EsitoVerificaAccordo }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // Il path deve stare nello spazio di chi chiama: impedisce di far puntare
  // il proprio profilo al file di qualcun altro (che comunque l'RLS dello
  // storage bloccherebbe in lettura, ma qui evitiamo pure di provarci).
  if (!storagePath.startsWith(`${profile.id}/accordo/`)) {
    return errore("Percorso del file non valido.");
  }

  if (!profile.pec) {
    return errore(
      "Prima di caricare l'accordo devi inserire la tua PEC nel profilo: è " +
        "necessaria per ricevere la copia certificata via PEC.",
    );
  }

  // --- PEC all'accesso globale -----------------------------------------
  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(
      e instanceof Error
        ? `La PEC non è configurata: ${e.message}`
        : "La PEC non è configurata.",
    );
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(storagePath);
  if (eBlob || !blob) {
    return errore("File non leggibile dallo storage.");
  }

  const nomeFile = storagePath.split("/").pop() ?? "accordo.pdf";
  const buffer = Buffer.from(await blob.arrayBuffer());
  const nome = profile.full_name ?? profile.email;

  // L'impronta certificata via PEC è quella VERA del file appena scaricato,
  // ricalcolata qui — mai quella dichiarata dal client. Altrimenti chiunque
  // potrebbe far certificare un'impronta diversa dal contenuto reale,
  // svuotando di senso l'intera certificazione.
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_path: storagePath,
      accordo_sha256: sha256,
      accordo_caricato_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (error) return errore(error.message);

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
