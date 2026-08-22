"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { leggiConfigPec, spedisciPec } from "@/lib/pec";
import { verificaAccordoFirmato, type EsitoVerificaAccordo } from "@/lib/gemini";
import { inviaEmailGmail } from "@/lib/mail";
import { COOKIE_VERSION, PRIVACY_VERSION, type Profile } from "@/lib/types";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

function errore(msg: string): Esito<never> {
  return { ok: false, errore: msg };
}

/** Escape minimo per interpolare testo libero dentro l'HTML generato lato server. */
function esc(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Esegue una promise ignorando gli errori (per le cancellazioni best-effort). */
async function ignora(p: PromiseLike<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    // cancellazione best-effort: se fallisce, non blocca il resto
  }
}

type CampiAnagrafica = Partial<
  Pick<Profile, "universita" | "pec" | "data_nascita" | "luogo_nascita" | "codice_fiscale">
>;

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
    .select("id, foto_path, accordo_path, role")
    .eq("id", userId)
    .single<{ id: string; foto_path: string | null; accordo_path: string | null; role: string }>();
  if (!profilo) return errore("Profilo non trovato.");
  // Un account con ruolo Titolare non si elimina da qui: servirebbe un cambio
  // di ruolo esplicito prima, altrimenti si perderebbe l'accesso globale.
  if (profilo.role === "admin") {
    return errore(
      "Non è possibile eliminare un account con ruolo Titolare da qui — serve un cambio di ruolo esplicito prima.",
    );
  }
  if (profilo.foto_path) {
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

  // Traccia l'eliminazione (chi, quando) nella catena di audit.
  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "eliminazione_account",
      entity_type: "profile",
      entity_id: userId,
      meta: { account: "ex" },
    }),
  );

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return { ok: true, dati: { account: "ex" } };
}

/** Una task collegata a un partecipante (per il riepilogo della revoca). */
export type TaskRiepilogoRevoca = {
  id: string;
  titolo: string;
  status: string;
  versioni: number;
};

/**
 * Riepilogo delle task con materiali video/audio caricati da un partecipante
 * on-screen (per la modale di conferma della revoca). Solo il Titolare.
 */
export async function riepilogoTaskOnScreen(
  userId: string,
): Promise<Esito<{ task: TaskRiepilogoRevoca[] }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin && profile.id !== userId) return errore("Operazione non disponibile da qui.");

  const admin = supabaseAdmin();
  const { data: versioni } = await admin
    .from("deliverable_versions")
    .select("id, deliverables!inner(id, task_id, kind)")
    .eq("uploaded_by", userId)
    .eq("origin", "originale")
    .eq("revocato_gdpr", false)
    .in("deliverables.kind", ["video_grezzo", "audio"])
    .returns<
      {
        id: string;
        deliverables: { id: string; task_id: string; kind: string };
      }[]
    >();

  // Raggruppa per task e conta le versioni coinvolte.
  const perTask = new Map<string, number>();
  for (const v of versioni ?? []) {
    const taskId = v.deliverables.task_id;
    perTask.set(taskId, (perTask.get(taskId) ?? 0) + 1);
  }
  const taskIds = [...perTask.keys()];
  if (taskIds.length === 0) return { ok: true, dati: { task: [] } };

  const { data: task } = await admin
    .from("tasks")
    .select("id, titolo, status")
    .in("id", taskIds)
    .order("created_at", { ascending: true })
    .returns<{ id: string; titolo: string; status: string }[]>();

  return {
    ok: true,
    dati: {
      task: (task ?? []).map((t) => ({
        id: t.id,
        titolo: t.titolo,
        status: t.status,
        versioni: perTask.get(t.id) ?? 0,
      })),
    },
  };
}

/**
 * Termina la collaborazione di un partecipante (solo Titolare).
 *
 * Uscire dal progetto e revocare il consenso a immagine/voce sono due atti
 * distinti (vedi revocaImmagineVoce più sotto): terminare la collaborazione
 * NON tocca più alcun file, per nessuno, indipendentemente da on_screen.
 * Chi appare in video resta online finché non è lui stesso a revocare quel
 * consenso — uscire dal progetto non lo implica.
 *
 * Disattiva l'account (attivo=false) e registra l'evento nell'audit_log
 * (la catena di hash la gestisce il trigger fn_audit_chain: niente calcoli
 * manuali qui).
 */
export async function terminaCollaborazione(
  userId: string,
  conferma: boolean,
): Promise<Esito<{ on_screen: boolean }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");
  if (!conferma) return errore("Conferma esplicita richiesta per terminare la collaborazione.");

  const admin = supabaseAdmin();

  const { data: target } = await admin
    .from("profiles")
    .select("id, on_screen, full_name, attivo, role")
    .eq("id", userId)
    .single<{ id: string; on_screen: boolean; full_name: string | null; attivo: boolean; role: string }>();
  if (!target) return errore("Profilo non trovato.");
  if (target.role === "admin") {
    return errore(
      "Non è possibile terminare un account con ruolo Titolare da qui — serve un cambio di ruolo esplicito prima.",
    );
  }
  if (!target.attivo) return errore("La collaborazione di questo partecipante è già terminata.");

  const motivo = `Fine collaborazione con ${target.full_name ?? target.id}`;

  await admin.from("profiles").update({ attivo: false }).eq("id", userId);

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "chiusura_collaborazione",
      entity_type: "profile",
      entity_id: userId,
      meta: { motivo },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: { on_screen: target.on_screen } };
}

/**
 * Riattiva la collaborazione di un account disattivato (solo Titolare). I
 * vecchi consensi restano revocati: l'utente li ridà da capo dal proprio
 * profilo (decisione documentata). Il login torna possibile perché
 * getSessionContext controlla attivo a ogni richiesta.
 */
export async function riattivaCollaborazione(userId: string): Promise<Esito> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");
  const admin = supabaseAdmin();

  const { data: target } = await admin
    .from("profiles")
    .select("id, attivo, role")
    .eq("id", userId)
    .single<{ id: string; attivo: boolean; role: string }>();
  if (!target) return errore("Profilo non trovato.");
  if (target.role === "admin") return errore("Gli account con ruolo Titolare non passano da qui.");
  if (target.attivo) return errore("Questo account è già attivo.");

  const { error } = await admin.from("profiles").update({ attivo: true }).eq("id", userId);
  if (error) return errore(error.message);

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "riattivazione_collaborazione",
      entity_type: "profile",
      entity_id: userId,
      meta: { motivo: "Riattivazione manuale da parte del Titolare" },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}

/**
 * Revoca del consenso a immagine/voce — atto AUTONOMO dal recesso, che il
 * Collaboratore stesso avvia dal proprio profilo (visibile solo se
 * on_screen). Nessuna cancellazione automatica (Accordo Art. 7.4): la
 * revoca apre SEMPRE una richiesta di revisione manuale del materiale
 * grezzo (richieste_eliminazione_grezzo), che il Coordinatore evaderà
 * individuando a occhio i file che ritraggono davvero la persona.
 * Contenuti GIÀ pubblicati: rimozione solo se richiesta esplicitamente
 * (richiediRimozionePubblicato=true), valutata caso per caso dal Titolare
 * (art. 17(3)(a) GDPR) — qui non si rimuove nulla di pubblicato.
 */
export async function revocaImmagineVoce(
  richiediRimozionePubblicato: boolean,
): Promise<Esito<{ richiestaGrezzoAperta: boolean; richiestaRimozioneAperta: boolean }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  // 1. Marca il consenso come revocato nel registro (append-only): la riga
  //    di concessione esiste dall'approvazione dell'Accordo (0096).
  await supabase.rpc("revoca_consenso", { p_tipo: "immagine_voce" });

  // 2. Apre SEMPRE la richiesta di revisione MANUALE del grezzo (30 giorni).
  let richiestaGrezzoAperta = false;
  const { error: eGrezzo } = await admin
    .from("richieste_eliminazione_grezzo")
    .insert({ user_id: profile.id });
  if (!eGrezzo) richiestaGrezzoAperta = true;

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "revoca_immagine_voce",
      entity_type: "profile",
      entity_id: profile.id,
      meta: {
        richiesta_eliminazione_grezzo: richiestaGrezzoAperta,
        richiesta_rimozione_pubblicato: richiediRimozionePubblicato,
      },
    }),
  );

  // 3. Pubblicato: solo se chiesto si apre la pratica (valutazione caso per
  //    caso); altrimenti scatta l'obbligo di notifica Art. 8.2 (0090).
  let richiestaRimozioneAperta = false;
  if (richiediRimozionePubblicato) {
    // Evita pratiche parallele: se esiste già una richiesta aperta per
    // questo utente, la si riusa invece di crearne un'altra.
    const { count } = await admin
      .from("richieste_rimozione_pubblicato")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("stato", "aperta");
    if (count && count > 0) {
      richiestaRimozioneAperta = true;
    } else {
      const { error: eIns } = await admin.from("richieste_rimozione_pubblicato").insert({
        user_id: profile.id,
      });
      if (!eIns) {
        richiestaRimozioneAperta = true;
        const { data: adminProfiles } = await admin
          .from("profiles")
          .select("email")
          .eq("role", "admin")
          .eq("attivo", true)
          .limit(1);
        const destinatario = adminProfiles?.[0]?.email;
        if (destinatario) {
          await ignora(
            inviaEmailGmail({
              destinatario,
              oggetto: "[ToothTalk] Richiesta di rimozione contenuti pubblicati",
              testo:
                `${profile.full_name ?? profile.email} ha revocato il consenso a immagine/voce ` +
                `e ha chiesto anche la rimozione dei contenuti già pubblicati che lo ritraggono.\n\n` +
                `Valutala dal Registro globale, sezione "Richieste di rimozione" — entro 30 giorni, ` +
                `prorogabili a 90 con motivazione scritta (art. 17(3)(a) GDPR).\n\n— ToothTalk`,
            }),
          );
        }
      }
    }
  } else {
    // Art. 8.2: il Coordinatore deve dargliene atto entro 30 giorni.
    await ignora(admin.from("notifiche_dovute_art82").insert({ user_id: profile.id }));
  }

  revalidatePath("/profilo");
  return { ok: true, dati: { richiestaGrezzoAperta, richiestaRimozioneAperta } };
}

/** Riga della coda "Notifiche dovute Art. 8.2" (solo Titolare). */
export type RigaNotificaArt82 = {
  id: string;
  user_id: string;
  revocato_at: string;
  scade_at: string;
  notificata_at: string | null;
};

/**
 * Il Titolare segna come inviata la notifica dell'Art. 8.2 (facoltà di
 * chiedere la rimozione del pubblicato). Manda davvero l'email al
 * Collaboratore: non è solo una spunta interna.
 */
export async function notificaArt82(id: string): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");

  // L'update usa la sessione dell'admin loggato (non il service_role): il
  // trigger fn_notifiche82_guard valorizza notificata_da := auth.uid(), e
  // col service_role auth.uid() sarebbe null — notificata_da resterebbe
  // sempre NULL (vedi nota nel test 2 dell'audit 0090). Le RLS su
  // notifiche_dovute_art82 e profiles permettono all'admin di leggere.
  const supabase = await supabaseServer();
  const { data: riga, error: eLettura } = await supabase
    .from("notifiche_dovute_art82")
    .select("id, user_id, notificata_at")
    .eq("id", id)
    .single<{ id: string; user_id: string; notificata_at: string | null }>();
  if (eLettura || !riga) return errore("Notifica non trovata.");
  if (riga.notificata_at) return errore("Già notificata.");

  const { data: destinatario } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", riga.user_id)
    .single<{ email: string; full_name: string | null }>();

  if (destinatario?.email) {
    await ignora(
      inviaEmailGmail({
        destinatario: destinatario.email,
        oggetto: "[ToothTalk] Contenuti pubblicati che ti ritraggono",
        testo:
          `Ciao ${destinatario.full_name ?? ""},\n\n` +
          `Hai revocato il consenso all'uso della tua immagine e voce. Il Coordinatore ` +
          `individuerà ed eliminerà, entro 30 giorni, il materiale grezzo non pubblicato ` +
          `che ti ritrae — non è una cancellazione automatica: il sistema registra chi ha ` +
          `caricato un file, non chi vi compare, quindi la verifica di quali file eliminare ` +
          `è sempre umana.\n\n` +
          `Ti informiamo che potrebbero esistere contenuti già pubblicati, alla data della revoca, ` +
          `che ti ritraggono. Hai facoltà di chiederne la rimozione o l'oscuramento in qualsiasi ` +
          `momento, scrivendo al Coordinatore: la richiesta viene valutata caso per caso ai sensi ` +
          `dell'art. 17, par. 3, GDPR (Art. 8.3 dell'Accordo Editoriale).\n\n— ToothTalk`,
      }),
    );
  }

  const { error } = await supabase
    .from("notifiche_dovute_art82")
    .update({ notificata_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return errore(error.message);

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}

/** Righe della coda "Richieste di rimozione" (solo Titolare). */
export type RigaRichiestaRimozione = {
  id: string;
  user_id: string;
  richiesto_at: string;
  termine_scadenza: string;
  stato: "aperta" | "risolta";
  esito: "rimosso" | "oscurato" | "rifiutato" | null;
  esito_motivazione: string | null;
  risolta_da: string | null;
  risolta_at: string | null;
};

/**
 * Il Titolare chiude una richiesta di rimozione di contenuti pubblicati,
 * registrando l'esito della valutazione (art. 17(3)(a) GDPR). Non rimuove
 * fisicamente nulla: quella resta un'azione manuale editoriale separata,
 * coerente con l'esito scelto qui.
 */
export async function risolviRichiestaRimozione(
  richiestaId: string,
  esito: "rimosso" | "oscurato" | "rifiutato",
  motivazione: string,
): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");
  if (!motivazione.trim()) return errore("Indica una motivazione per la decisione.");

  const supabase = await supabaseServer();
  const { data: richiesta, error: eLettura } = await supabase
    .from("richieste_rimozione_pubblicato")
    .select("user_id")
    .eq("id", richiestaId)
    .single<{ user_id: string }>();
  if (eLettura || !richiesta) return errore("Richiesta non trovata.");

  const { error } = await supabase
    .from("richieste_rimozione_pubblicato")
    .update({ stato: "risolta", esito, esito_motivazione: motivazione.trim() })
    .eq("id", richiestaId);
  if (error) return errore(error.message);

  // Traccia la decisione (chi, quando, esito) nella catena di audit.
  const { profile } = await requireSession();
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "risoluzione_richiesta_rimozione",
      entity_type: "richiesta_rimozione_pubblicato",
      entity_id: richiestaId,
      meta: {
        user_id: richiesta.user_id,
        esito,
        motivazione: motivazione.trim(),
      },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}

/** Righe della coda "Richieste eliminazione grezzo" (solo Titolare). */
export type RigaEliminazioneGrezzo = {
  id: string;
  user_id: string;
  richiesto_at: string;
  termine_scadenza: string;
  stato: "aperta" | "risolta";
  versioni_eliminate: string[] | null;
  note_coordinatore: string | null;
  risolta_da: string | null;
  risolta_at: string | null;
};

/**
 * Il Coordinatore evaderà una richiesta di eliminazione grezzo (Accordo Art.
 * 7.4): seleziona ESPLICITAMENTE i file che ritraggono davvero la persona che
 * ha revocato, li marca revocato_gdpr e li cancella dallo storage. Il filtro
 * iniziale (uploaded_by = chi ha revocato) serve solo a restringere la lista
 * a schermo, MAI come criterio automatico di cancellazione.
 */
export async function eseguiEliminazioneGrezzo(
  richiestaId: string,
  versionIds: string[],
  note?: string,
): Promise<Esito> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");
  if (!versionIds.length) return errore("Seleziona almeno un file da eliminare.");

  const admin = supabaseAdmin();
  // La sessione admin serve per: la RPC (is_admin() legge auth.uid()) e la
  // chiusura (il trigger valorizza risolta_da := auth.uid()).
  const supabase = await supabaseServer();

  const { data: richiesta } = await admin
    .from("richieste_eliminazione_grezzo")
    .select("id, user_id, stato")
    .eq("id", richiestaId)
    .single<{ id: string; user_id: string; stato: string }>();
  if (!richiesta) return errore("Richiesta non trovata.");
  if (richiesta.stato !== "aperta") return errore("Richiesta già risolta.");

  // Candidati "di partenza": caricati dalla persona che ha revocato, kind
  // video_grezzo/audio/immagini_montaggio (uno still può ritrarre la persona).
  const { data: candidati } = await admin
    .from("deliverable_versions")
    .select("id, deliverables!inner(kind)")
    .eq("uploaded_by", richiesta.user_id)
    .eq("revocato_gdpr", false)
    .in("deliverables.kind", ["video_grezzo", "audio", "immagini_montaggio"])
    .returns<{ id: string; deliverables: { kind: string } }[]>();

  const ammessi = new Set((candidati ?? []).map((c) => c.id));
  const selezionati = versionIds.filter((v) => ammessi.has(v));
  if (selezionati.length !== versionIds.length) {
    return errore("Alcuni file selezionati non sono tra i candidati di questa richiesta.");
  }

  // Marca revocato_gdpr (transizione consentita dal trigger append-only) e
  // restituisce bucket/storage_path per la cancellazione fisica.
  const { data: righe, error: eRpc } = await supabase.rpc("revoca_video_on_screen", {
    p_version_ids: selezionati,
  });
  if (eRpc) return errore(`Eliminazione rifiutata dal database: ${eRpc.message}`);
  const tipizzate = (righe ?? []) as {
    version_id: string;
    bucket: string;
    storage_path: string;
    task_id: string;
  }[];
  for (const r of tipizzate) {
    await ignora(admin.storage.from(r.bucket).remove([r.storage_path]));
  }

  // Chiude la richiesta (il trigger valorizza risolta_at/risolta_da).
  const { error: eChiusura } = await supabase
    .from("richieste_eliminazione_grezzo")
    .update({
      stato: "risolta",
      versioni_eliminate: selezionati,
      note_coordinatore: note?.trim() || null,
    })
    .eq("id", richiestaId);
  if (eChiusura) return errore(eChiusura.message);

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "eliminazione_grezzo_manuale",
      entity_type: "profile",
      entity_id: richiesta.user_id,
      meta: {
        richiesta_id: richiestaId,
        versioni_eliminate: selezionati,
        note: note?.trim() || null,
      },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}

export async function aggiornaAnagrafica(campi: CampiAnagrafica): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // Il campo "Email o PEC" è facoltativo e accetta qualunque indirizzo
  // valido (anche una normale email). Una PEC vera dà in più la
  // certificazione di consegna, ma non è più richiesta per partecipare.
  if (campi.pec && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(campi.pec)) {
    return errore("Inserisci un indirizzo email valido (o lascia vuoto).");
  }

  // Il codice fiscale, se inserito, deve avere la forma standard italiana:
  // serve a compilare il Modulo di nomina (Documento 4), non solo a essere
  // "presente". Un valore malformato lo renderebbe inutilizzabile lì.
  if (campi.codice_fiscale) {
    const cf = campi.codice_fiscale.trim().toUpperCase();
    if (!/^[A-Z0-9]{16}$/.test(cf)) {
      return errore("Il codice fiscale deve avere 16 caratteri alfanumerici.");
    }
    campi = { ...campi, codice_fiscale: cf };
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

  // 1. Registra il consenso nella tabella — è la prova legale, deve sempre
  //    riuscire. Nulla qui sotto deve poter far fallire questa riga.
  const { data: consenso, error } = await supabase.from("consensi").insert({
    user_id: profile.id,
    tipo,
    versione,
  }).select("id").single<{ id: string }>();
  if (error || !consenso) return errore(error?.message ?? "Errore registrazione consenso.");

  // 2. Genera ricevuta HTML firmata (SHA256) — prova dimostrabile per GDPR.
  //    Best-effort: se la generazione, l'upload o la chiave admin falliscono,
  //    il consenso è comunque registrato. Mai errori all'utente.
  try {
    const dataIso = new Date().toISOString();
    const tipoLabel = tipo === "privacy" ? "Informativa Privacy" : "Cookie Policy";
    const html =
      `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Ricevuta consenso — ToothTalk</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#1e293b}` +
      `h1{font-size:1.2em}.data{color:#64748b;font-size:.85em;margin-top:2em}</style></head><body>` +
      `<h1>Ricevuta di consenso — ToothTalk</h1>` +
      `<p><strong>Utente:</strong> ${profile.full_name} (${profile.email})</p>` +
      `<p><strong>Consenso:</strong> ${tipoLabel} v${versione}</p>` +
      `<p><strong>Accettato il:</strong> ${dataIso}</p>` +
      `<p><strong>Metodo:</strong> click su interfaccia web autenticata</p>` +
      `<p class="data">Progetto ToothTalk — Documento certificato.</p></body></html>`;

    const buffer = Buffer.from(html, "utf8");
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const storagePath = `consensi/${profile.id}/${tipo}_v${versione}_${consenso.id}.html`;

    try {
      const admin = supabaseAdmin();
      const { error: eUpload } = await admin.storage.from("finali").upload(storagePath, buffer, {
        contentType: "text/html; charset=utf-8", upsert: false,
      });
      if (eUpload) {
        console.error("Upload ricevuta consenso fallito:", eUpload.message);
      } else {
        await admin.from("consensi").update({ storage_path: storagePath, sha256 }).eq("id", consenso.id);
      }
    } catch (e) {
      console.error("Upload ricevuta consenso THROWS (ignorato):", e);
    }
  } catch (e) {
    console.error("Generazione ricevuta consenso fallita (ignorata):", e);
  }

  revalidatePath("/");
  return { ok: true, dati: undefined };
}

/** Revoca il consenso GDPR (privacy o cookie) per l'utente corrente. Append-only: la revoca viene registrata sulle righe esistenti, mai cancellate. Non tocca le liberatorie già firmate (prova legale). */
export async function revocaConsenso(tipo: "privacy" | "cookie"): Promise<Esito> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("revoca_consenso", { p_tipo: tipo });
  if (error) return errore(error.message);

  revalidatePath("/");
  revalidatePath("/profilo");
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
  haLettoCompreso: boolean,
): Promise<Esito<{ messageId: string; verifica: EsitoVerificaAccordo }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  // Il path deve stare nello spazio di chi chiama: impedisce di far puntare
  // il proprio profilo al file di qualcun altro (che comunque l'RLS dello
  // storage bloccherebbe in lettura, ma qui evitiamo pure di provarci).
  if (!storagePath.startsWith(`${profile.id}/accordo/`)) {
    return errore("Percorso del file non valido.");
  }

  // La spunta "ho letto e compreso" è obbligatoria: non ci si fida del solo
  // controllo lato client (un disabled sul bottone si aggira facilmente),
  // quindi si respinge qui il caricamento se non arriva true.
  if (haLettoCompreso !== true) {
    return errore(
      "Devi confermare di aver letto e compreso l'accordo editoriale prima di caricarlo.",
    );
  }

  // Data/luogo di nascita e codice fiscale servono a compilare il Modulo di
  // nomina (Documento 4), generato automaticamente alla approvazione di
  // questo stesso accordo: se mancano ora, mancheranno anche allora.
  if (!profile.data_nascita || !profile.luogo_nascita || !profile.codice_fiscale) {
    return errore(
      "Completa prima data di nascita, luogo di nascita e codice fiscale nella scheda anagrafica: servono per il Modulo di nomina che verrà generato quando l'accordo sarà approvato.",
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
      accordo_letto_confermato: true,
    })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  // Registro granulare consents_and_releases (GDPR): accordo collaboratore.
  // L'accordo è UNO SOLO per tutti i collaboratori (on-screen o backstage):
  // la cessione dei diritti di immagine e autore è già dentro l'unico
  // documento. Il flag on_screen resta rilevante solo per la revoca GDPR.
  try {
    await supabaseAdmin().from("consents_and_releases").insert({
      task_id: null,
      user_id: profile.id,
      tipo_soggetto: "collaboratore",
      tipo: "accordo_collaboratore",
      nome_soggetto: nome,
      email_soggetto: profile.email,
      storage_path: storagePath,
      sha256,
      metodo_firma: null,
      firmato_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Registrazione accordo in consents_and_releases fallita (ignorata):", e);
  }

  // --- controllo IA sull'accordo (segnalazione, mai blocco) ------------
  // La verifica confronta il documento col MODELLO attivo (ultima riga di
  // modello_accordo): senza un modello di riferimento l'IA non può fare il
  // confronto e restituisce 'non_valutato'.
  let modelloBase64: string | undefined;
  let modelloMime: string | undefined;
  try {
    const { data: modello } = await supabase
      .from("modello_accordo")
      .select("storage_path")
      .order("caricato_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ storage_path: string }>();
    if (modello) {
      const { data: blobModello, error: eMod } = await supabase.storage
        .from("finali")
        .download(modello.storage_path);
      if (!eMod && blobModello) {
        modelloBase64 = Buffer.from(await blobModello.arrayBuffer()).toString("base64");
        modelloMime = blobModello.type || "application/pdf";
      }
    }
  } catch {
    // se il recupero del modello fallisce, si procede senza confronto
  }

  const verifica = await verificaAccordoFirmato({
    pdfBase64: buffer.toString("base64"),
    mimeType: blob.type || "application/pdf",
    modelloBase64,
    modelloMimeType: modelloMime,
  });

  // Se non c'era un modello di riferimento, l'esito 'non_valutato' con nota
  // esplicita: l'admin vedrà che serve caricare il modello prima.
  const nota =
    verifica.esito === "non_valutato" && !modelloBase64
      ? "Nessun modello di riferimento caricato: carica prima il modello dell'accordo."
      : verifica.note;

  const { error: eVerifica } = await supabase
    .from("profiles")
    .update({
      accordo_verificato: verifica.esito,
      accordo_verifica_note: nota || null,
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
        `${nome} ha caricato il proprio accordo editoriale ToothTalk e ha`,
        "dichiarato, spuntando l'apposita casella prima del caricamento, di",
        "aver letto e compreso integralmente il contenuto dell'accordo.",
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
    <strong>${nome}</strong> ha caricato il proprio accordo editoriale ToothTalk e ha
    dichiarato, spuntando l'apposita casella prima del caricamento, di aver letto e
    compreso integralmente il contenuto dell'accordo.
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
      // La copia al partecipante viaggia sulla sua PEC/email se l'ha
      // indicata; altrimenti resta solo la certificazione all'accesso
      // globale. La PEC non è obbligatoria per partecipare.
      copiaConoscenza: profile.pec ? [profile.pec] : undefined,
    });

    revalidatePath("/profilo");
    return { ok: true, dati: { messageId, verifica } };
  } catch (e) {
    return errore(
      `Accordo salvato ma PEC non partita: ${e instanceof Error ? e.message : "errore di spedizione"}`,
    );
  }
  }

/** Genera un URL firmato per scaricare una ricevuta di consenso (admin only). */
/**
 * Carica il MODELLO dell'accordo editoriale (lato admin): il documento
 * che viene inviato ai collaboratori per la firma. Ogni caricamento è una
 * NUOVA riga in modello_accordo (storico append-only in pratica); il
 * modello attivo è l'ultima riga. L'impronta SHA-256 è ricalcolata
 * lato server, mai fidarsi del valore dichiarato dal client.
 */
/**
 * Il Collaboratore comunica la propria volontà di recedere (Art. 8
 * dell'Accordo): registra la richiesta con timestamp immutabile nella
 * tabella richieste_recesso (append-only). Da richiesto_at decorrono i
 * 30 giorni di preavviso — la data certa è quella del gestionale, non
 * quella di un'email.
 */
export async function richiediRecesso(
  motivazione?: string,
): Promise<Esito<{ richiestoAt: string }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("richieste_recesso")
    .insert({
      user_id: profile.id,
      motivazione: motivazione?.trim() ? motivazione.trim() : null,
    })
    .select("richiesto_at")
    .single<{ richiesto_at: string }>();
  if (error) return errore(error.message);

  // Traccia l'evento anche nell'audit log (catena di hash).
  await ignora(
    supabase.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "richiesta_recesso",
      entity_type: "profile",
      entity_id: profile.id,
      meta: {
        motivazione: motivazione?.trim() ? motivazione.trim() : null,
        richiesto_at: data.richiesto_at,
      },
    }),
  );

  revalidatePath("/profilo");
  return { ok: true, dati: { richiestoAt: data.richiesto_at } };
}


export async function caricaModelloAccordo(
  storagePath: string,
): Promise<Esito<{ id: string }>> {
  const { profile } = await requireSession();
  if (profile.role !== "admin") return errore("Solo il Titolare può caricare il modello.");

  const supabase = await supabaseServer();

  if (!storagePath.startsWith("modello-accordo/")) {
    return errore("Percorso del file non valido.");
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("finali")
    .download(storagePath);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { data, error } = await supabase
    .from("modello_accordo")
    .insert({ storage_path: storagePath, sha256, caricato_da: profile.id })
    .select("id")
    .single<{ id: string }>();
  if (error) return errore(error.message);

  revalidatePath("/admin");
  return { ok: true, dati: { id: data.id } };
}

/**
 * L'Admin approva la registrazione di un collaboratore: attiva l'account,
 * conferma/corregge il flag on_screen (serve per la correttezza della
 * revoca GDPR, non per scegliere un accordo — l'accordo è unico per tutti)
 * e invia alla PEC del collaboratore il MODELLO dell'accordo da firmare,
 * con il Titolare in copia. Prima di approvare serve aver caricato il
 * modello (caricaModelloAccordo).
 */
export async function approvaRegistrazione(
  userId: string,
  onScreenConfermato: boolean,
): Promise<Esito<{ messageId: string }>> {
  const { profile: admin } = await requireSession();
  if (admin.role !== "admin") return errore("Solo il Titolare può approvare registrazioni.");

  const supabase = await supabaseServer();

  // Ultimo modello caricato = quello attivo.
  const { data: modello } = await supabase
    .from("modello_accordo")
    .select("storage_path")
    .order("caricato_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ storage_path: string }>();
  if (!modello) {
    return errore("Nessun modello di accordo caricato: caricalo prima di approvare registrazioni.");
  }

  const { data: richiedente } = await supabase
    .from("profiles")
    .select("full_name, email, pec, universita")
    .eq("id", userId)
    .single<{ full_name: string | null; email: string; pec: string | null; universita: string | null }>();
  // La PEC è facoltativa: se assente, l'accordo va all'email di accesso
  // (il canale minimo garantito), senza la certificazione di consegna.
  if (!richiedente?.email) return errore("Questo utente non ha un contatto email valido.");

  let config;
  try {
    config = leggiConfigPec();
  } catch (e) {
    return errore(e instanceof Error ? e.message : "PEC non configurata.");
  }

  const { data: blobModello, error: eBlob } = await supabase.storage
    .from("finali")
    .download(modello.storage_path);
  if (eBlob || !blobModello) return errore("Impossibile leggere il modello dell'accordo.");
  const bufferModello = Buffer.from(await blobModello.arrayBuffer());
  const nomeModello = modello.storage_path.split("/").pop() ?? "accordo-editoriale.pdf";
  const nome = richiedente.full_name ?? richiedente.email;

  const { error: eUpdate } = await supabase
    .from("profiles")
    .update({
      attivo: true,
      on_screen: onScreenConfermato,
      approvato_at: new Date().toISOString(),
      approvato_da: admin.id,
    })
    .eq("id", userId);
  if (eUpdate) return errore(eUpdate.message);

  // Traccia l'approvazione della registrazione nella catena di audit.
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: admin.id,
      actor_role: admin.role,
      action: "approvazione_registrazione",
      entity_type: "profile",
      entity_id: userId,
      meta: { on_screen: onScreenConfermato, utente: richiedente?.full_name ?? null },
    }),
  );

  try {
    const { messageId } = await spedisciPec({
      config,
      oggetto: `[ToothTalk] Benvenuto/a in ToothTalk — un ultimo passo prima di partire`,
      testo: [
        "",
        `Ciao ${nome}, benvenuto/a in ToothTalk!`,
        "",
        "La tua registrazione è stata approvata: da oggi fai parte del progetto,",
        "e non vediamo l'ora di iniziare a lavorare insieme.",
        "",
        "Un solo passaggio prima di partire: in allegato trovi l'accordo",
        "editoriale. Leggilo con calma, firmalo e ricaricalo dal tuo profilo",
        "nel gestionale (sezione \"Accordo editoriale\").",
        "",
        "Al momento del caricamento ti verrà chiesto di confermare di averlo",
        "letto e compreso: quella conferma, insieme all'accordo firmato, ti",
        "arriverà a sua volta via PEC con data certa — così hai sempre traccia",
        "di tutto.",
        "",
        "Se hai domande o dubbi, scrivici pure: siamo qui per questo.",
        "",
        "A presto,",
        "il team ToothTalk",
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Benvenuto/a in ToothTalk 🦷</h1>
  <p style="font-size:13px;line-height:1.6">
    Ciao <strong>${nome}</strong>, la tua registrazione è stata approvata: da oggi
    fai parte del progetto, e non vediamo l'ora di iniziare a lavorare insieme.
  </p>
  <p style="font-size:13px;line-height:1.6">
    Un solo passaggio prima di partire: in allegato trovi l'accordo editoriale.
    Leggilo con calma, firmalo e ricaricalo dal tuo profilo nel gestionale.
  </p>
  <p style="font-size:12px;color:#666">
    Al caricamento ti verrà chiesto di confermare di averlo letto e compreso:
    quella conferma, insieme all'accordo firmato, ti arriverà a sua volta via
    PEC con data certa — così hai sempre traccia di tutto.
  </p>
  <p style="font-size:13px;line-height:1.6;margin-top:16px">
    Se hai domande o dubbi, scrivici pure: siamo qui per questo.<br>
    A presto,<br>il team ToothTalk
  </p>
</div>`,
      allegati: [{ filename: nomeModello, content: bufferModello, contentType: "application/pdf" }],
      // "to": la persona — PEC se presente, altrimenti la sua email di
      // accesso (la PEC non è più obbligatoria per partecipare).
      destinatari: [richiedente.pec ?? richiedente.email],
      copiaConoscenza: config.destinatari, // "cc": accesso globale
    });
    revalidatePath("/admin");
    return { ok: true, dati: { messageId } };
  } catch (e) {
    return errore(
      `Account approvato ma PEC non partita: ${e instanceof Error ? e.message : "errore di spedizione"}`,
    );
  }
}


export async function scaricaRicevutaConsenso(consensoId: string): Promise<Esito<string>> {
  const { profile } = await requireSession();
  if (profile.role !== "admin") return errore("Solo l'admin può scaricare le ricevute.");

  const admin = supabaseAdmin();
  const { data: c } = await admin.from("consensi")
    .select("storage_path").eq("id", consensoId).single<{ storage_path: string | null }>();
  if (!c?.storage_path) return errore("Ricevuta non ancora generata.");

  const { data } = await admin.storage.from("finali").createSignedUrl(c.storage_path, 300);
  if (!data?.signedUrl) return errore("Impossibile generare il link.");
  return { ok: true, dati: data.signedUrl };
}

/**
 * Portabilità dei dati personali (GDPR Art. 20): esporta in un unico file
 * JSON tutti i dati dell'utente corrente — profilo, consensi (incluso lo
 * stato di revoca), appartenenze ai poli, e l'elenco dei materiali che ha
 * depositato (senza i file: quelli restano nell'archivio di tutela legale).
 * Il file viene generato al volo e restituito come testo (il browser lo
 * salva). Non tocca né cancella nulla: è una copia per l'interessato.
 */
export async function esportaDatiPersonali(): Promise<Esito<{ nome: string; contenuto: string }>> {
  const { profile } = await requireSession();
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  const [consensi, memberships, poli, materiali] = await Promise.all([
    supabase.from("consensi").select("tipo, versione, accettato_at, revocato_at")
      .eq("user_id", profile.id).order("accettato_at", { ascending: true }),
    supabase.from("memberships").select("polo_id, poli(nome)")
      .eq("user_id", profile.id),
    supabase.from("poli").select("id, nome").order("nome"),
    admin.from("deliverable_versions")
      .select("file_name, mime_type, size_bytes, sha256, uploaded_at, deliverables!inner(kind, task_id)")
      .eq("uploaded_by", profile.id)
      .order("uploaded_at", { ascending: true })
      .returns<{
        file_name: string; mime_type: string | null; size_bytes: number | null;
        sha256: string; uploaded_at: string; deliverables: { kind: string; task_id: string };
      }[]>(),
  ]);

  const nomiPoli = new Map((poli.data ?? []).map((p) => [p.id, p.nome]));
  const pacchetto = {
    generato_il: new Date().toISOString(),
    emittente: "ToothTalk — gestionale interno",
    normativa: "Esportazione ai sensi dell'art. 20 GDPR (diritto alla portabilità)",
    interessato: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      universita: profile.universita,
      ruolo: profile.role,
    },
    consensi: (consensi.data ?? []).map((c) => ({
      tipo: c.tipo, versione: c.versione, accettato_at: c.accettato_at,
      revocato_at: c.revocato_at ?? null,
    })),
    appartenenza_poli: (memberships.data ?? []).map((m) => ({
      polo: nomiPoli.get(m.polo_id) ?? m.polo_id,
    })),
    materiali_depositati: (materiali.data ?? []).map((v) => ({
      kind: v.deliverables.kind,
      file_name: v.file_name,
      mime_type: v.mime_type,
      size_bytes: v.size_bytes,
      sha256: v.sha256,
      upload_at: v.uploaded_at,
    })),
    nota:
      "I file multimediali e i documenti firmati non sono inclusi: fanno parte dell'archivio di tutela legale conservato per il periodo di prescrizione (art. 17(3)(e) GDPR).",
  };

  const nome = `toothtalk-dati-personali-${profile.id.slice(0, 8)}.json`;
  return { ok: true, dati: { nome, contenuto: JSON.stringify(pacchetto, null, 2) } };
}




/**
 * L'Admin aggiorna il flag "appare in video" di un partecipante dopo
 * l'approvazione (es. una persona che prima non appariva e poi inizia a
 * comparire nei video). Il flag serve alla revoca GDPR: chi appare ha
 * diritto di far purgare i propri video. Solo il Titolare può cambiarlo
 * (la guardia fn_protect_profile lo protegge lato database).
 */
export async function impostaOnScreen(
  userId: string,
  appare: boolean,
): Promise<Esito<{ appare: boolean }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("profiles")
    .update({ on_screen: appare })
    .eq("id", userId);
  if (error) return errore(error.message);

  // Traccia il cambio (chi, quando, nuovo valore) nella catena di audit.
  await ignora(
    supabase.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "cambio_on_screen",
      entity_type: "profile",
      entity_id: userId,
      meta: { appare_in_video: appare },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: { appare } };
}

/**
 * Genera il Modulo di nomina individuale (Documento 4): atto unilaterale
 * del Titolare, generato dal gestionale nel momento stesso in cui approva
 * l'Accordo — nessuna firma o azione ulteriore richiesta al Collaboratore.
 * Segue lo stesso schema già usato da registraConsenso per le ricevute:
 * HTML statico, hash SHA-256, upload nel bucket "finali" (nessuna libreria
 * PDF è presente nel progetto — introdurne una solo per questo sarebbe
 * sproporzionato; l'HTML generato si stampa in PDF dal browser se serve).
 *
 * Best-effort per costruzione: se fallisce, l'approvazione dell'accordo
 * (già avvenuta) NON viene disfatta. L'errore torna nel messaggio così
 * l'admin sa che deve rigenerare il modulo a mano o segnalarlo.
 */
async function generaModuloNomina(
  userId: string,
  approvatoAt: string,
): Promise<{ ok: true } | { ok: false; errore: string }> {
  const admin = supabaseAdmin();

  const { data: c } = await admin
    .from("profiles")
    .select("full_name, email, pec, codice_fiscale, data_nascita, luogo_nascita, accordo_caricato_at")
    .eq("id", userId)
    .single<{
      full_name: string | null;
      email: string;
      pec: string | null;
      codice_fiscale: string | null;
      data_nascita: string | null;
      luogo_nascita: string | null;
      accordo_caricato_at: string | null;
    }>();
  if (!c) return { ok: false, errore: "Utente non trovato." };
  if (!c.codice_fiscale || !c.data_nascita || !c.luogo_nascita) {
    return {
      ok: false,
      errore: "Mancano codice fiscale, data o luogo di nascita: completali dal profilo prima di generare il modulo.",
    };
  }

  const nome = c.full_name ?? c.email;
  const dataNascitaIt = new Date(c.data_nascita).toLocaleDateString("it-IT");
  const dataSottoscrizioneIt = c.accordo_caricato_at
    ? new Date(c.accordo_caricato_at).toLocaleDateString("it-IT")
    : "—";
  const dataApprovazioneIt = new Date(approvatoAt).toLocaleString("it-IT");

  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<title>Modulo di nomina individuale — ${nome}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#0d1b2a;line-height:1.6}
  h1{font-size:1.35em;text-align:center;margin-bottom:1.4em}
  h2{font-size:1em;margin-top:1.6em}
  ul{padding-left:1.2em}
  li{margin-bottom:.4em}
  .sig{margin-top:2.5em}
  .meta{color:#64748b;font-size:.8em;margin-top:3em;border-top:1px solid #e2e8f0;padding-top:1em}
</style></head><body>
<h1>MODULO DI NOMINA INDIVIDUALE A PERSONA AUTORIZZATA AL TRATTAMENTO</h1>

<p>Il sottoscritto Enrico Maria Guarino, C.F. GRNNCM05H20C342W, in qualità di Titolare del
trattamento e Coordinatore del progetto editoriale &quot;Tooth Talk&quot;,</p>

<h2>DICHIARA E NOMINA</h2>

<p>che <strong>${esc(nome)}</strong>, nato/a a ${esc(c.luogo_nascita)} il ${dataNascitaIt},
C.F. ${esc(c.codice_fiscale)}, avendo sottoscritto in data ${dataSottoscrizioneIt} l'Accordo
Editoriale per la collaborazione volontaria al Progetto &quot;Tooth Talk&quot;, è nominato/a persona
autorizzata al trattamento dei dati personali ai sensi dell'art. 29 del Regolamento (UE) 2016/679
(GDPR) e dell'art. 2-quaterdecies del D.Lgs. 196/2003 e s.m.i. (Codice Privacy), sotto l'autorità
e le istruzioni documentate del Titolare del trattamento.</p>

<h2>Ambito dell'autorizzazione</h2>
<ul>
  <li>Raccolta dei recapiti (email o PEC) dei soggetti esterni intervistati, mediante dichiarazione a video in apertura di ripresa;</li>
  <li>Inserimento immediato di tali recapiti nel gestionale del Progetto, che provvede autonomamente all'invio, alla raccolta della firma digitale e alla conservazione delle liberatorie;</li>
  <li><strong>Custodia temporanea del materiale grezzo (file video/audio) esclusivamente per il tempo strettamente necessario al caricamento sul gestionale (entro 48-72 ore dalla ripresa, e comunque non oltre 24 ore dalla conferma di avvenuto caricamento).</strong></li>
</ul>

<p>Il Collaboratore, nell'esercizio della presente autorizzazione, non ha alcuna autonomia
decisionale sulle finalità e sui mezzi del trattamento, ed è tenuto a:</p>
<ul>
  <li>Non raccogliere, non custodire e non trasmettere alcun documento cartaceo contenente dati personali degli intervistati, in nessuna circostanza;</li>
  <li>Inserire i recapiti nel gestionale immediatamente dopo la registrazione;</li>
  <li>Non condividere i dati raccolti (recapiti, video, audio) con altri Collaboratori o terzi al di fuori del caricamento diretto sul gestionale;</li>
  <li><strong>Cancellare la copia locale del materiale grezzo subito dopo la conferma di avvenuto caricamento, e comunque entro 24 ore dalla ricezione della conferma;</strong></li>
  <li>Mantenere il proprio dispositivo protetto da blocco schermo/PIN e, ove possibile, da crittografia del volume;</li>
  <li>Comunicare al Coordinatore, senza indugio, qualsiasi violazione dei dati personali di cui venga a conoscenza nello svolgimento delle proprie attività.</li>
</ul>

<h2>Durata dell'autorizzazione</h2>
<p>La presente nomina ha effetto per tutta la durata della collaborazione con il Progetto
&quot;Tooth Talk&quot;, come definita dall'Accordo Editoriale, e può essere revocata in qualsiasi
momento dal Coordinatore con comunicazione scritta.</p>

<p>Le istruzioni operative di cui agli Artt. 6.2 e 6.3 dell'Accordo Editoriale, già sottoscritto
dal Collaboratore, si intendono integralmente richiamate e vincolanti ai fini della presente
nomina.</p>

<p>Il presente modulo viene generato dal gestionale all'esito dell'approvazione dell'Accordo
Editoriale da parte del Titolare, e reso disponibile al Collaboratore per sua conoscenza e
conservazione.</p>

<p class="sig">Luogo e data: Genova, ${dataApprovazioneIt}</p>
<p class="sig">Firma del Coordinatore (Titolare del trattamento): Enrico Maria Guarino</p>

<p class="meta">Documento generato automaticamente dal gestionale ToothTalk al momento
dell'approvazione dell'accordo da parte del Titolare (atto unilaterale, nessuna firma
elettronica aggiuntiva richiesta). L'impronta SHA-256 di questo file, calcolata al momento
della generazione, ne garantisce l'immodificabilità.</p>
</body></html>`;

  const buffer = Buffer.from(html, "utf8");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storagePath = `nomina/${userId}/modulo-nomina_${approvatoAt.slice(0, 10)}.html`;

  const { error: eUpload } = await admin.storage.from("finali").upload(storagePath, buffer, {
    contentType: "text/html; charset=utf-8",
    upsert: true,
  });
  if (eUpload) return { ok: false, errore: `Upload del modulo fallito: ${eUpload.message}` };

  const { error: eUpdate } = await admin
    .from("profiles")
    .update({
      nomina_path: storagePath,
      nomina_sha256: sha256,
      nomina_generata_at: approvatoAt,
    })
    .eq("id", userId);
  if (eUpdate) return { ok: false, errore: `Modulo generato ma non registrato: ${eUpdate.message}` };

  // Notifica al Collaboratore — via Gmail: non è un atto che richieda data
  // certa PEC (quella copre già l'accordo), è solo un avviso di disponibilità.
  await ignora(
    inviaEmailGmail({
      destinatario: c.pec ?? c.email,
      oggetto: "[ToothTalk] Modulo di nomina disponibile",
      testo:
        `Ciao ${nome},\n\nIl tuo accordo editoriale è stato approvato. Il Titolare ha ` +
        `contestualmente generato il tuo Modulo di nomina a persona autorizzata al ` +
        `trattamento dei dati (Documento 4): lo trovi nel tuo profilo sul gestionale, ` +
        `sezione "Accordo editoriale".\n\nNon devi fare nulla: è un documento a tua ` +
        `disposizione per conoscenza e conservazione.\n\n— ToothTalk`,
    }),
  );

  return { ok: true };
}

/**
 * Il Titolare approva MANUALMENTE l'accordo di un collaboratore: è la
 * quarta condizione (oltre a caricato + letto/confermato + verifica IA ok)
 * che sblocca l'accesso ai progetti. L'approvazione è tracciata in
 * audit_log. Solo admin.
 *
 * Nello stesso passaggio genera automaticamente il Modulo di nomina
 * (Documento 4, Art. 6.5 dell'Accordo): è il click di approvazione stesso
 * a perfezionare la nomina, non serve una firma separata.
 */
export async function approvaAccordoManualmente(
  userId: string,
): Promise<Esito<{ approvatoAt: string; nomina: "ok" | "errore"; nominaErrore?: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata al Titolare.");

  const supabase = await supabaseServer();

  // Controllo di coerenza: si approva solo un accordo che esiste.
  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, accordo_path, accordo_letto_confermato, accordo_verificato, accordo_approvato_admin_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      accordo_path: string | null;
      accordo_letto_confermato: boolean;
      accordo_verificato: string | null;
      accordo_approvato_admin_at: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.accordo_path) return errore("Nessun accordo caricato per questo utente.");
  if (target.accordo_approvato_admin_at) return errore("Accordo già approvato.");

  const ora = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_approvato_admin_at: ora,
      accordo_approvato_da: profile.id,
    })
    .eq("id", userId);
  if (error) return errore(error.message);

  // La firma dell'Accordo vale quale concessione del consenso a immagine/
  // voce (Art. 7.1): si registra la riga nel registro consensi (0096), così
  // la successiva revoca ha una riga su cui incidere (dimostrabilità artt.
  // 5(2) e 7(1) GDPR). Idempotente: non si crea una seconda riga se esiste.
  // L'insert usa il service_role: la RLS consensi_insert richiede
  // user_id = auth.uid(), ma qui la riga è per il collaboratore approvato.
  // ignora() assorbe gli errori: best-effort, non blocca l'approvazione.
  await ignora(
    supabaseAdmin().from("consensi").insert({
      user_id: userId,
      tipo: "immagine_voce",
      versione: "implicito",
      accettato_at: ora,
    }),
  );

  // Traccia l'approvazione nella catena di audit.
  await ignora(
    supabase.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "approvazione_accordo_admin",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: target.full_name,
        accordo_verificato: target.accordo_verificato,
        approvato_at: ora,
      },
    }),
  );

  // Generazione del Documento 4 — best-effort: un suo fallimento non deve
  // far sembrare fallita l'approvazione dell'accordo, già avvenuta sopra.
  const esitoNomina = await generaModuloNomina(userId, ora);
  if (!esitoNomina.ok) {
    await ignora(
      supabase.from("audit_log").insert({
        actor: profile.id,
        actor_role: profile.role,
        action: "generazione_nomina_fallita",
        entity_type: "profile",
        entity_id: userId,
        meta: { errore: esitoNomina.errore },
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return {
    ok: true,
    dati: {
      approvatoAt: ora,
      nomina: esitoNomina.ok ? "ok" : "errore",
      nominaErrore: esitoNomina.ok ? undefined : esitoNomina.errore,
    },
  };
}

/**
 * Restituisce un link firmato e temporaneo al Modulo di nomina (Documento
 * 4) del chiamante — o, se admin, di un userId a scelta. Come per la PEC,
 * il download passa dal server: nessun bucket è pubblico.
 */
export async function scaricaDocumentoNomina(userId?: string): Promise<Esito<string>> {
  const { profile, isAdmin } = await requireSession();
  const target = userId && isAdmin ? userId : profile.id;
  if (userId && userId !== profile.id && !isAdmin) {
    return errore("Puoi scaricare solo il tuo modulo di nomina.");
  }

  const admin = supabaseAdmin();
  const { data: c } = await admin
    .from("profiles")
    .select("nomina_path")
    .eq("id", target)
    .single<{ nomina_path: string | null }>();
  if (!c?.nomina_path) return errore("Modulo di nomina non ancora generato.");

  const { data } = await admin.storage.from("finali").createSignedUrl(c.nomina_path, 300);
  if (!data?.signedUrl) return errore("Impossibile generare il link.");
  return { ok: true, dati: data.signedUrl };
}


