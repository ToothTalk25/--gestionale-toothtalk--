"use server";

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { inviaPushAdmin } from "@/lib/push";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession, getSessionContext } from "@/lib/auth";
import { accodaPec, destinatariPecGlobali } from "@/lib/pec";
import { verificaAccordoFirmato, type EsitoVerificaAccordo } from "@/lib/gemini";
import { inviaEmailGmail } from "@/lib/mail";
import { archiviaAccordoSuDrive } from "@/lib/google-doc";
import { COOKIE_VERSION, PRIVACY_VERSION, type Profile } from "@/lib/types";
import { dataOra, soloData } from "@/lib/data-ora";

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
  art94Confermata?: boolean,
): Promise<Esito<{ account: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!conferma) return errore("Conferma di essere consapevole di cosa stai eliminando.");

  // Solo chi ha accesso globale, o la persona stessa sul proprio account.
  if (!isAdmin && profile.id !== userId) {
    return errore("Operazione non disponibile da qui.");
  }

  // Art. 9.4: chi esce da sé deve confermare di aver cancellato le copie
  // locali (è l'unico modo per registrare la "comunicazione al Coordinatore"
  // prima che l'account sparisca). Il Titolare non è vincolato a questa
  // dichiarazione: se elimina un account dopo una chiusura, la conferma
  // pendente resta visibile nel Registro finché il Collaboratore non la dà.
  if (profile.id === userId && art94Confermata !== true) {
    return errore(
      "Devi confermare di aver cancellato le copie locali dei materiali e dei dati di terzi (Art. 9.4 dell'Accordo Editoriale) prima di uscire.",
    );
  }

  const admin = supabaseAdmin();

  // 1. Foto del profilo (l'accordo resta: è il titolo della cessione di proprietà)
  const { data: profilo } = await admin
    .from("profiles")
    .select("id, foto_path, accordo_path, role, approvato_at, full_name, email")
    .eq("id", userId)
    .single<{
      id: string;
      foto_path: string | null;
      accordo_path: string | null;
      role: string;
      approvato_at: string | null;
      full_name: string | null;
      email: string;
    }>();
  if (!profilo) return errore("Profilo non trovato.");
  // Un account con ruolo Titolare non si elimina da qui: servirebbe un cambio
  // di ruolo esplicito prima, altrimenti si perderebbe l'accesso globale.
  if (profilo.role === "admin") {
    return errore(
      "Non è possibile eliminare un account con ruolo di amministrazione da qui — serve un cambio di ruolo esplicito prima.",
    );
  }

  // Richiesta di registrazione mai approvata: non esiste ancora nessun
  // accordo, materiale o certificazione da tutelare (nulla da "conservare"),
  // quindi l'account va eliminato per davvero invece di essere anonimizzato.
  // profiles.id referenzia auth.users(id) on delete cascade (0001_schema.sql):
  // cancellare l'utente Auth cancella automaticamente anche la riga profiles.
  if (profilo.approvato_at === null) {
    // admin.auth.admin.deleteUser NON lancia mai un'eccezione per un errore
    // Auth/Postgres (restituisce sempre { data, error }, verificato in
    // GoTrueAdminApi.js): un try/catch qui non intercetterebbe mai il
    // vincolo di chiave esterna. In più GoTrue incapsula l'errore Postgres
    // originale in un messaggio generico ("Database error deleting user",
    // verificato empiricamente) senza il nome della tabella coinvolta: non
    // c'è quindi un messaggio specifico da tradurre con traduciErroreDb qui,
    // solo un indizio plausibile da dare all'admin. La causa reale resta nei
    // log del server per chi deve indagare.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("eliminaAccount: deleteUser fallita per richiesta mai approvata:", error.message);
      return errore(
        "Non è stato possibile eliminare questa richiesta: probabilmente ci sono richieste aperte (GDPR o ricarica dichiarazione) collegate a questo profilo. Risolvile dalle rispettive code, poi riprova.",
      );
    }

    // entity_id non ha una FK verso profiles (deve sopravvivere anche quando
    // l'entità sparisce): senza nome/email nel meta, dopo la delete quell'id
    // da solo non porterebbe a nessuna informazione recuperabile.
    await ignora(
      admin.from("audit_log").insert({
        actor: profile.id,
        actor_role: profile.role,
        action: "rifiuto_registrazione",
        entity_type: "profile",
        entity_id: userId,
        meta: { nome: profilo.full_name, email: profilo.email },
      }),
    );

    revalidatePath("/admin");
    return { ok: true, dati: { account: "eliminato" } };
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
      // Uscita volontaria: la conferma Art. 9.4 è data in questo stesso
      // momento (richiesta e conferma coincidono). L'audit sotto ne lascia
      // traccia immutabile anche dopo l'anonimizzazione del profilo.
      ...(profile.id === userId
        ? {
            cancellazione_copie_richiesta_at: new Date().toISOString(),
            cancellazione_copie_confermata_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq("id", userId);

  // 5. Rimozione dell'account di accesso (se l'archivio lo consente;
  //    altrimenti resta disattivato: attivo=false impedisce di entrare).
  // admin.auth.admin.deleteUser NON lancia mai un'eccezione per un errore
  // Auth/Postgres (restituisce sempre { data, error }, stesso comportamento
  // verificato per il ramo "mai approvato" sopra): il try/catch qui non
  // intercetterebbe mai il vincolo di chiave esterna, va letto error.
  let davveroEliminato = false;
  const { error: eDeleteUser } = await admin.auth.admin.deleteUser(userId);
  if (!eDeleteUser) {
    davveroEliminato = true;
  } else {
    // Il database non permette di cancellare (ci sono riferimenti
    // nell'archivio: il registro degli eventi è append-only e non si tocca).
    // L'account resta, disattivato — ma NON deve continuare a tenere occupato
    // il suo indirizzo email: altrimenti quella persona non può più
    // registrarsi con la propria casella, e chi riprova trova "esiste già un
    // account" senza avere più alcun accesso. Si anonimizza anche il contatto
    // di accesso, esattamente come si fa per il profilo.
    await ignora(
      admin.auth.admin.updateUserById(userId, {
        email: `ex-${userId.slice(0, 8)}@toothtalk.local`,
        email_confirm: true,
      }),
    );
  }

  // Traccia l'eliminazione (chi, quando) nella catena di audit.
  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "eliminazione_account",
      entity_type: "profile",
      entity_id: userId,
      meta: { account: davveroEliminato ? "eliminato" : "ex", nome: profilo.full_name, email: profilo.email },
    }),
  );

  // Uscita volontaria: conferma Art. 9.4 registrata nello stesso atto.
  if (profile.id === userId) {
    await ignora(
      admin.from("audit_log").insert({
        actor: profile.id,
        actor_role: profile.role,
        action: "conferma_cancellazione_copie",
        entity_type: "profile",
        entity_id: userId,
        meta: { articolo: "9.4", mezzo: "uscita volontaria dal gestionale" },
      }),
    );
  }

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return { ok: true, dati: { account: davveroEliminato ? "eliminato" : "anonimizzato" } };
}

/**
 * Conferma Art. 9.4 Accordo Editoriale: il Collaboratore uscente dichiara di
 * aver cancellato tutte le copie locali dei materiali grezzi, dei recapiti e
 * degli altri dati personali di terzi, entro 48 ore dalla cessazione.
 * Accessibile SOLO dallo stato "solo conferma uscita" (account disattivato
 * con richiesta pendente): registra data e ora in audit_log e chiude la
 * richiesta. Nessun blocco tecnico: se non arriva, resta visibile nel
 * Registro come "conferma non ancora ricevuta".
 */
export async function confermaCancellazioneCopie(): Promise<Esito> {
  const ctx = await getSessionContext();
  if (!ctx?.soloConfermaUscita) {
    return errore("Nessuna conferma di uscita in attesa per questo account.");
  }

  const admin = supabaseAdmin();
  const ora = new Date().toISOString();

  const { error } = await admin
    .from("profiles")
    .update({ cancellazione_copie_confermata_at: ora })
    .eq("id", ctx.profile.id);
  if (error) return errore(error.message);

  await ignora(
    admin.from("audit_log").insert({
      actor: ctx.profile.id,
      actor_role: ctx.profile.role,
      action: "conferma_cancellazione_copie",
      entity_type: "profile",
      entity_id: ctx.profile.id,
      meta: { articolo: "9.4", mezzo: "pagina di conferma uscita" },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
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
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");
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
      "Non è possibile terminare un account con ruolo di amministrazione da qui — serve un cambio di ruolo esplicito prima.",
    );
  }
  if (!target.attivo) return errore("La collaborazione di questo partecipante è già terminata.");

  const motivo = `Fine collaborazione con ${target.full_name ?? target.id}`;

  await admin.from("profiles").update({
    attivo: false,
    // Art. 9.4 Accordo: la chiusura fa partire le 48 ore entro cui il
    // Collaboratore deve confermare di aver cancellato le copie locali.
    // La conferma avviene dal flusso dedicato /uscita (o all'uscita
    // volontaria via eliminaAccount): nessun blocco tecnico, resta solo
    // visibile nel Registro come "conferma non ancora ricevuta".
    cancellazione_copie_richiesta_at: new Date().toISOString(),
  }).eq("id", userId);

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "chiusura_collaborazione",
      entity_type: "profile",
      entity_id: userId,
      meta: { motivo, art94: "conferma_copie_locali_richiesta" },
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
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");
  const admin = supabaseAdmin();

  const { data: target } = await admin
    .from("profiles")
    .select("id, attivo, role")
    .eq("id", userId)
    .single<{ id: string; attivo: boolean; role: string }>();
  if (!target) return errore("Profilo non trovato.");
  if (target.role === "admin") return errore("Gli account con ruolo di amministrazione non passano da qui.");
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
      meta: { motivo: "Riattivazione manuale da parte dell'accesso globale" },
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
                `prorogabili a 90 con motivazione scritta (art. 17(3)(a) GDPR).\n\n— ToothTalk™`,
            }),
          );
        }
      }
    }
  } else {
    // Art. 8.2: il Coordinatore deve dargliene atto entro 30 giorni.
    await ignora(admin.from("notifiche_dovute_art82").insert({ user_id: profile.id }));
  }

  // Avviso immediato: c'è una revoca da gestire (il grezzo da eliminare e, se
  // chiesto, la pratica di rimozione del pubblicato).
  await inviaPushAdmin({
    title: "Revoca consenso immagine/voce — ToothTalk",
    body: `${profile.full_name ?? profile.email} ha revocato il consenso: c'è una richiesta da gestire.`,
    url: "/admin",
  });

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
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

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
          `Hai revocato il consenso all'uso della tua immagine e voce. L'accesso globale ` +
          `individuerà ed eliminerà, entro 30 giorni, il materiale grezzo non pubblicato ` +
          `che ti ritrae — non è una cancellazione automatica: il sistema registra chi ha ` +
          `caricato un file, non chi vi compare, quindi la verifica di quali file eliminare ` +
          `è sempre umana.\n\n` +
          `Ti informiamo che potrebbero esistere contenuti già pubblicati, alla data della revoca, ` +
          `che ti ritraggono. Hai facoltà di chiederne la rimozione o l'oscuramento in qualsiasi ` +
          `momento, scrivendo all'accesso globale: la richiesta viene valutata caso per caso ai sensi ` +
          `dell'art. 17, par. 3, GDPR (Art. 8.3 dell'Accordo Editoriale).\n\n— ToothTalk™`,
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
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");
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
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");
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
  const { profile, isAdmin } = await requireSession();
  // Scrive col service_role: i campi anagrafici sono protetti dal trigger
  // fn_protect_profile (0103) — solo admin/service_role possono aggiornarli.
  const supabase = supabaseAdmin();

  // Dopo la conferma reciproca della controfirma (0118), codice fiscale,
  // data e luogo di nascita sono gli stessi che compaiono nel Modulo di
  // Nomina già generato: cambiarli in autonomia li renderebbe disallineati
  // dal documento firmato. Da qui in poi serve una correzione via admin.
  // Il form del profilo invia sempre tutti i campi insieme (anche la PEC,
  // non bloccata): si rifiuta solo un valore diverso da quello già salvato,
  // non la semplice presenza della chiave nel payload.
  if (profile.accordo_controfirma_confermata_at && !isAdmin) {
    const tentaCambio =
      (campi.codice_fiscale !== undefined && campi.codice_fiscale !== profile.codice_fiscale) ||
      (campi.data_nascita !== undefined && campi.data_nascita !== profile.data_nascita) ||
      (campi.luogo_nascita !== undefined && campi.luogo_nascita !== profile.luogo_nascita);
    if (tentaCambio) {
      return errore(
        "Questi dati sono bloccati dopo la conferma reciproca dell'accordo controfirmato; contatta il Titolare per una correzione.",
      );
    }
  }

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

/** Chiavi di storage: solo caratteri sicuri, il nome vero resta nel client. */
function sanifica(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

/**
 * Nome leggibile di un file preso dallo storage.
 *
 * Lo storage antepone a ogni file un uuid per evitare le collisioni
 * (`<uuid>__<nome originale>`): serve lì dentro, ma non deve arrivare a chi
 * riceve il documento — il Collaboratore che apre
 * "d25e5363-b74b-413c-a64b-8816866db5fb__1-accordo-editoriale.pdf" vede
 * un'impronta al posto del titolo (segnalato dall'accesso globale, che se lo
 * è trovato anche negli allegati). Nella cartella Drive, invece, il documento
 * archiviato si chiama già "Nome Cognome.pdf".
 */
function nomeFileUmano(path: string): string {
  const nome = path.split("/").pop() ?? "documento.pdf";
  return nome.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i, "");
}

type EsitoUpload = Esito<{ bucket: string; path: string; signedUrl: string; token: string }>;

/**
 * Firma un URL di upload one-shot su cui il chiamante può caricare un file
 * dritto su Storage. Il cookie di sessione è HttpOnly (0071/0117/0118): il
 * client non può più autenticarsi da solo per un upload diretto — si firma
 * qui, dove il cookie si legge benissimo, un URL valido una volta sola per
 * QUESTO path esatto (stesso schema di preparaUpload in actions.ts). Il
 * client poi lo consuma con uploadToSignedUrl: il token è la sua
 * autorizzazione, non serve più leggere una sessione lato browser.
 */
/**
 * `comeServizio`: la policy INSERT su "finali" (finali_insert) è scritta
 * solo per il dominio task/deliverable — richiede un path a 3 segmenti
 * tutti UUID (storage_path_valido) e verifica is_member_of/task_aperta su
 * quei segmenti. Un path come "modello-accordo/..." o "controfirma/<uid>/…"
 * non ha quella forma: la sessione dell'utente, anche admin, non l'ha mai
 * potuta scrivere lì (nessun bypass is_admin() in quella policy — verificato
 * a mano sulle policy reali). Per questi due casi si firma con service_role,
 * che salta l'RLS: l'autorizzazione la fa comunque il controllo
 * `role === "admin"` nella action chiamante, prima di arrivare qui.
 */
async function firmaUpload(bucket: string, path: string, comeServizio = false): Promise<EsitoUpload> {
  const supabase = comeServizio ? supabaseAdmin() : await supabaseServer();
  const { data: firma, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !firma) return errore("Impossibile preparare il caricamento.");
  return { ok: true, dati: { bucket, path, signedUrl: firma.signedUrl, token: firma.token } };
}

/** Prepara l'upload della propria foto profilo (collaboratore o admin). */
export async function preparaUploadFoto(fileName: string): Promise<EsitoUpload> {
  const { profile } = await requireSession();
  return firmaUpload("profili", `${profile.id}/foto/${randomUUID()}__${sanifica(fileName)}`);
}

/**
 * Prepara l'upload del proprio accordo firmato. Stesso blocco di
 * caricaAccordo dopo la conferma reciproca della controfirma (0118): niente
 * ricaricamenti silenziosi a documento ormai chiuso.
 */
export async function preparaUploadAccordo(fileName: string): Promise<EsitoUpload> {
  const { profile } = await requireSession();
  if (profile.accordo_controfirma_confermata_at) {
    return errore(
      "Questi dati sono bloccati dopo la conferma reciproca dell'accordo controfirmato; contatta il Titolare per una correzione.",
    );
  }
  return firmaUpload("profili", `${profile.id}/accordo/${randomUUID()}__${sanifica(fileName)}`);
}

/** Prepara l'upload del proprio documento di rinnovo (Art. 9.1). */
export async function preparaUploadRinnovo(fileName: string): Promise<EsitoUpload> {
  const { profile } = await requireSession();
  if (!profile.accordo_path || !profile.accordo_approvato_admin_at) {
    return errore("Nessun accordo approvato da rinnovare.");
  }
  return firmaUpload("profili", `${profile.id}/rinnovo/${randomUUID()}__${sanifica(fileName)}`);
}

/** Prepara l'upload del modello dell'accordo editoriale (admin only). */
export async function preparaUploadModelloAccordo(fileName: string): Promise<EsitoUpload> {
  const { profile } = await requireSession();
  if (profile.role !== "admin") return errore("Solo chi ha accesso globale può caricare il modello.");
  return firmaUpload("finali", `modello-accordo/${randomUUID()}__${sanifica(fileName)}`, true);
}

/** Prepara l'upload della scansione controfirmata di un collaboratore (admin only). */
export async function preparaUploadControfirma(userId: string, fileName: string): Promise<EsitoUpload> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");
  return firmaUpload("finali", `controfirma/${userId}/${randomUUID()}__${sanifica(fileName)}`, true);
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

/**
 * URL firmato (valido un'ora) per una foto dal bucket privato 'profili'.
 *
 * La firma la chiede il server, non il browser: i cookie di sessione sono
 * HttpOnly (il token non è leggibile da JavaScript), quindi dal browser il
 * client Supabase non vede la sessione e createSignedUrl falliva sempre — le
 * foto comparivano come «—». Era lo stesso motivo per cui non appariva il
 * banner di consenso (CONTESTO.md, voce 15).
 *
 * Il permesso resta quello dell'utente: la firma si chiede con la sua sessione,
 * quindi valgono esattamente le policy dello storage di prima.
 */
export async function urlFotoProfilo(
  path: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  await requireSession();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.storage.from("profili").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return { ok: false };
  return { ok: true, url: data.signedUrl };
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
 * Il modello dell'accordo attivo è l'ULTIMA riga di modello_accordo: è il
 * documento che i Collaboratori ricevono e firmano, quindi il termine di
 * confronto della verifica IA. Ritorna null (senza lanciare) se non c'è o
 * non è leggibile: chi chiama prosegue lo stesso e l'esito sarà
 * 'non_valutato' con una nota esplicita — meglio un esito incerto che
 * impedire il salvataggio di un accordo firmato.
 */
async function caricaModelloAttivo(): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const admin = supabaseAdmin();
    const { data: modello } = await admin
      .from("modello_accordo")
      .select("storage_path")
      .order("caricato_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ storage_path: string }>();
    if (!modello) return null;

    const { data: blob, error } = await admin.storage.from("finali").download(modello.storage_path);
    if (error || !blob) return null;

    return {
      base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
      mimeType: blob.type || "application/pdf",
    };
  } catch {
    return null;
  }
}

/**
 * Manda all'accesso globale il PDF di un accordo firmato, dalla casella del
 * progetto, e ne lascia traccia nel registro. Una sola formulazione per
 * tutti i casi in cui il documento viaggia per email invece che per PEC: il
 * ripiego automatico quando la PEC non parte al caricamento (caricaAccordo)
 * e la copia chiesta dal Titolare per la controfirma
 * (inviaAccordoFirmatoPerEmail). Così quello che arriva è sempre lo stesso
 * messaggio, non una variante che nessuno ha riletto.
 *
 * Best-effort per costruzione: non lancia mai e ritorna false se nessun
 * amministratore è stato raggiunto, così chi chiama non deve proteggersi.
 */
async function inviaAccordoAgliAmministratori(opts: {
  /** Chi figura come autore nel registro: il Collaboratore nel ripiego, il Titolare su richiesta. */
  actorId: string;
  actorRole: string;
  /** Il profilo del Collaboratore a cui l'accordo appartiene. */
  entityId: string;
  buffer: Buffer;
  nomeFile: string;
  contentType?: string;
  nome: string;
  /**
   * true SOLO quando la PEC con data certa è davvero caduta: l'avviso in
   * fondo al messaggio lo dichiara, e dichiararlo quando non è vero
   * screditerebbe il registro. La copia chiesta dall'admin non lo include.
   */
  avvisoDataCerta: boolean;
  /** Riga di registro: distingue il ripiego automatico dalla copia richiesta. */
  azione: string;
  motivo: string;
}): Promise<boolean> {
  let recapito = false;
  try {
    const { data: amministratori } = await supabaseAdmin()
      .from("profiles")
      .select("email")
      .eq("role", "admin")
      .eq("attivo", true);
    for (const a of amministratori ?? []) {
      if (!a.email) continue;
      const inviata = await inviaEmailGmail({
        destinatario: a.email,
        oggetto: `[ToothTalk] Accordo firmato da verificare — ${opts.nome}`,
        testo: [
          "",
          `${opts.nome} ha caricato il proprio accordo editoriale firmato.`,
          "",
          "In allegato il PDF firmato.",
          "",
          ...(opts.avvisoDataCerta
            ? [
                "ATTENZIONE: la PEC con data certa NON è partita (o non è mai",
                "entrata in coda): va rimessa in coda e spedita dal computer, per",
                "dare al documento la sua data certa.",
                "",
              ]
            : []),
          "Messaggio generato automaticamente dal gestionale ToothTalk.",
          "",
        ].join("\n"),
        allegati: [
          {
            filename: opts.nomeFile,
            content: opts.buffer,
            contentType: opts.contentType || "application/pdf",
          },
        ],
      });
      recapito = recapito || inviata;
    }
  } catch {
    // best-effort: se anche il ripiego fallisce resta il messaggio d'errore
  }

  if (recapito) {
    await ignora(
      supabaseAdmin().from("audit_log").insert({
        actor: opts.actorId,
        actor_role: opts.actorRole,
        action: opts.azione,
        entity_type: "profile",
        entity_id: opts.entityId,
        meta: { motivo: opts.motivo, utente: opts.nome },
      }),
    );
  }
  return recapito;
}

/**
 * Il messaggio con cui si deposita un accordo firmato (PEC all'accesso
 * globale, copia alla persona). Sta qui e non dentro le due azioni che lo
 * usano — il caricamento e la rimessa in coda di un deposito rimasto senza PEC
 * — perché è un testo che finisce in una PEC con data certa: due versioni
 * diverse dello stesso messaggio legale sarebbero un problema.
 */
function messaggioDepositoAccordo({ nome, sha256 }: { nome: string; sha256: string }) {
  return {
    oggetto: `[ToothTalk] Accordo editoriale — ${nome}`,
    testo: [
      "",
      `Ciao!`,
      "",
      `${nome} ha caricato il proprio accordo editoriale ToothTalk e ha`,
      "dichiarato, spuntando l'apposita casella prima del caricamento, di",
      "aver letto e compreso integralmente il contenuto dell'accordo editoriale e del Protocollo Operativo ad esso allegato.",
      "",
      "Il PDF allegato è firmato e viene registrato con data certa: fa parte",
      "del registro dei partecipanti.",
      "",
      "Impronta SHA-256 del file:",
      `  ${sha256}`,
      "",
      "Messaggio generato automaticamente dal gestionale ToothTalk.",
      "",
    ].join("\n"),
    html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk™</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Accordo editoriale — ${nome}</h1>
  <p style="font-size:13px;line-height:1.6">
    <strong>${nome}</strong> ha caricato il proprio accordo editoriale ToothTalk e ha
    dichiarato, spuntando l'apposita casella prima del caricamento, di aver letto e
    compreso integralmente il contenuto dell'accordo editoriale e del Protocollo
    Operativo ad esso allegato.
    Il PDF allegato è firmato e viene registrato con data certa: fa parte del
    registro dei partecipanti.
  </p>
  <p style="font-size:12px;color:#666">Impronta SHA-256: <span style="font-family:monospace">${sha256}</span></p>
  <p style="font-size:11px;color:#999">Messaggio generato automaticamente dal gestionale ToothTalk.</p>
</div>`,
  };
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
): Promise<Esito<{ inCoda: string; verifica: EsitoVerificaAccordo }>> {
  const { profile } = await requireSession();
  // Scrive col service_role: i campi accordo sono protetti dal trigger
  // fn_protect_profile (0103) — solo admin/service_role possono scriverli.
  const supabase = supabaseAdmin();

  // Dopo la conferma reciproca della controfirma (0118), l'accordo è
  // "chiuso": un nuovo caricamento richiederebbe di rifare da capo anche la
  // controfirma del Titolare e la conferma del Collaboratore. Se serve
  // davvero correggere qualcosa a questo punto, serve un intervento admin
  // diretto, non un ricaricamento silenzioso dal profilo.
  if (profile.accordo_controfirma_confermata_at) {
    return errore(
      "Questi dati sono bloccati dopo la conferma reciproca dell'accordo controfirmato; contatta il Titolare per una correzione.",
    );
  }

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
      "Devi confermare di aver letto e compreso l'accordo editoriale e il Protocollo Operativo prima di caricarlo.",
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

  // L'Art. 2.5 dell'Accordo è una dichiarazione di maggiore età sotto la
  // responsabilità del Collaboratore: non impedisce da sola che un
  // minorenne firmi mentendo. La data di nascita è già obbligatoria (sopra):
  // la usiamo anche per un controllo reale.
  const oggi = new Date();
  const nascita = new Date(profile.data_nascita);
  let eta = oggi.getFullYear() - nascita.getFullYear();
  const meseGiorno = oggi.getMonth() - nascita.getMonth() || oggi.getDate() - nascita.getDate();
  if (meseGiorno < 0) eta--;
  if (eta < 18) {
    return errore(
      "La sottoscrizione dell'Accordo Editoriale è riservata a chi ha già compiuto 18 anni.",
    );
  }

  // Il PDF firmato si rilegge dallo storage (mai un file indicato dal client):
  // serve per l'impronta vera e, se la coda non accettasse la riga, per il
  // ripiego via email del progetto.
  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(storagePath);
  if (eBlob || !blob) {
    return errore("File non leggibile dallo storage.");
  }

  const nomeFile = nomeFileUmano(storagePath);
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
      // Un accordo nuovo È la risposta alla richiesta di ricaricarlo (0140):
      // la richiesta ha esaurito il suo scopo e sparisce dallo schermo. La riga
      // che la registrava resta nel registro, che non si cancella.
      accordo_ricarica_richiesta_at: null,
      accordo_ricarica_motivo: null,
    })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  // Niente copia su Drive qui: l'accordo caricato ha una sola firma (quella
  // del Collaboratore). La copia d'archivio in "Gestione canale/accordi/"
  // si fa solo dalla scansione controfirmata dal Titolare (entrambe le
  // firme), in caricaControfirmaAccordo — questa PEC resta comunque la
  // certificazione con data certa della firma del Collaboratore.

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
  const modello = await caricaModelloAttivo();

  const verifica = await verificaAccordoFirmato({
    pdfBase64: buffer.toString("base64"),
    mimeType: blob.type || "application/pdf",
    modelloBase64: modello?.base64,
    modelloMimeType: modello?.mimeType,
  });

  // Se non c'era un modello di riferimento, l'esito 'non_valutato' con nota
  // esplicita: l'admin vedrà che serve caricare il modello prima.
  const nota =
    verifica.esito === "non_valutato" && !modello
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

  // Conferma immediata alla persona: fino a ieri chi caricava l'accordo non
  // riceveva niente — la PEC del deposito va all'accesso globale, non a lei, e
  // l'unica traccia era il messaggio a schermo in quel momento. Questa email
  // dice una cosa sola e vera: il documento è arrivato, e tocca a noi
  // controllarlo. Best-effort: se non parte, nulla si blocca (inviaEmailGmail
  // ritorna false invece di lanciare).
  await inviaEmailGmail({
    destinatario: profile.email,
    oggetto: "[ToothTalk] Abbiamo ricevuto il tuo accordo firmato",
    testo: [
      "",
      `Ciao ${nome},`,
      "",
      "il tuo accordo editoriale firmato è arrivato: l'abbiamo registrato e ne",
      "conserviamo l'impronta, che trovi qui sotto.",
      "",
      "Che cosa succede adesso: lo controlliamo noi, poi l'accesso globale carica",
      "la copia controfirmata e ti chiediamo di confermare che è lo stesso",
      "documento che hai firmato. Da quel momento si sblocca l'accesso ai",
      "progetti. La PEC con data certa arriverà sulla tua casella quando sarà",
      "spedita.",
      "",
      "Se il documento non fosse leggibile o completo te lo scriviamo qui: non",
      "serve che tu faccia nulla adesso. Lo trovi sempre nel tuo profilo,",
      "sezione \"Accordo editoriale\".",
      "",
      "Impronta SHA-256 del file che abbiamo ricevuto:",
      `  ${sha256}`,
      "",
      "— ToothTalk™",
      "",
    ].join("\n"),
    html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="font-size:13px;line-height:1.6">Ciao <strong>${esc(nome)}</strong>,</p>
  <p style="font-size:13px;line-height:1.6">
    il tuo accordo editoriale firmato <strong>è arrivato</strong>: l&apos;abbiamo registrato
    e ne conserviamo l&apos;impronta, che trovi qui sotto.
  </p>
  <p style="font-size:13px;line-height:1.6">
    Che cosa succede adesso: lo controlliamo noi, poi l&apos;accesso globale carica la
    copia controfirmata e ti chiediamo di confermare che è lo stesso documento che hai
    firmato. Da quel momento si sblocca l&apos;accesso ai progetti. La PEC con data
    certa arriverà sulla tua casella quando sarà spedita.
  </p>
  <p style="font-size:12px;color:#666">
    Se il documento non fosse leggibile o completo te lo scriviamo qui: non serve che
    tu faccia nulla adesso.
  </p>
  <p style="font-size:12px;color:#666">Impronta SHA-256: <span style="font-family:monospace">${sha256}</span></p>
  <p style="font-size:13px;line-height:1.6;margin-top:16px">— ToothTalk™</p>
</div>`,
  });

  // La PEC non parte più da qui: entra in coda (0139) e la spedisce il
  // computer, perché Aruba blocca gli invii automatici che escono da
  // indirizzi esteri — e Vercel non ha regioni italiane. Se la coda non
  // accetta la riga, il documento firmato deve comunque arrivare all'accesso
  // globale: è il catch qui sotto.
  try {
    // Il "to" della PEC resta l'accesso globale: è lui che conserva la
    // certificazione. La copia alla persona, invece, va SEMPRE — sulla sua PEC
    // se l'ha indicata, altrimenti sulla sua email di accesso. Prima la
    // riceveva solo chi aveva una PEC: chi non l'aveva restava senza il proprio
    // documento certificato, ed era un buco, non una scelta (0140).
    const destinatariGlobali = destinatariPecGlobali();
    const copiaPersona = profile.pec ?? profile.email;

    const { id: inCoda } = await accodaPec({
      destinatari: destinatariGlobali,
      ...messaggioDepositoAccordo({ nome, sha256 }),
      allegati: [
        // Riferimento, non byte: lo script rilegge il PDF dallo storage e
        // verifica l'impronta PRIMA di spedire. Il bucket del caricamento
        // dell'accordo è "profili".
        { nome: nomeFile, bucket: "profili", percorso: storagePath, sha256 },
      ],
      copiaConoscenza: destinatariGlobali.includes(copiaPersona) ? undefined : [copiaPersona],
      // Marca il tipo e il documento: serve a non mettere in coda due volte la
      // PEC dello stesso deposito (mettiInCodaPecDeposito cerca questa impronta).
      contesto: { tipo: "deposito", profile_id: profile.id },
    });

    // Avviso immediato all'accesso globale: c'è un accordo da verificare.
    // Best-effort (inviaPushAdmin non lancia mai): se il telefono non ha le
    // notifiche attive, l'operazione resta valida come prima.
    await inviaPushAdmin({
      title: "Accordo da verificare — ToothTalk",
      body: `${profile.full_name ?? profile.email} ha caricato l'accordo firmato.`,
      url: "/admin",
    });

    revalidatePath("/profilo");
    return { ok: true, dati: { inCoda, verifica } };
  } catch (e) {
    // La coda non ha accettato la riga: la PEC non esiste da nessuna parte, e
    // il documento firmato deve arrivare comunque all'accesso globale —
    // altrimenti nessuno sa che c'è un accordo da verificare (è successo
    // davvero, con due accordi caricati e nessun avviso). Il ripiego (PDF via
    // email del progetto e una riga nel registro) vive in
    // inviaAccordoAgliAmministratori, perché è lo stesso messaggio della copia
    // chiesta dall'admin; qui l'avviso sulla data certa ci va, perché la PEC
    // non esiste. La data certa resta da ottenere: va rimesso in coda.
    const recapito = await inviaAccordoAgliAmministratori({
      actorId: profile.id,
      actorRole: profile.role,
      entityId: profile.id,
      buffer,
      nomeFile: nomeFileUmano(storagePath),
      contentType: blob.type || "application/pdf",
      nome,
      avvisoDataCerta: true,
      azione: "accordo_inviato_gmail_recupero",
      motivo: "PEC non entrata in coda al caricamento dell'accordo",
    });
    return errore(
      recapito
        ? `Accordo salvato e inviato per email, ma la PEC non è entrata in coda: ${e instanceof Error ? e.message : "errore di accodamento"}`
        : `Accordo salvato ma né PEC né email sono partite: ${e instanceof Error ? e.message : "errore di accodamento"}`,
    );
  }
  }

/**
 * Rifa la verifica IA su un accordo GIÀ caricato (solo accesso globale).
 *
 * Esiste perché la verifica può non essere riuscita al momento del
 * caricamento: è successo davvero, con la chiave dell'IA non configurata sul
 * server — due accordi veri finiti in "non_valutato" e invisibili nella coda
 * di approvazione. Il file però è già nello storage e integro: mancava solo
 * il confronto col modello. Senza questa azione l'unica uscita sarebbe
 * chiedere al Collaboratore di ricaricare un documento che è già a posto.
 *
 * Rilegge il PDF dallo storage (mai un file indicato dal client) e riscrive
 * l'esito. Non approva nulla: un esito 'ok' fa solo comparire l'accordo in
 * "Accordi da approvare", dove resta la controfirma manuale.
 */
export async function rivalutaAccordoConIA(
  userId: string,
): Promise<Esito<{ esito: string; note: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  // Scrive col service_role: i campi accordo_* sono protetti dal trigger
  // fn_protect_profile (0103) — solo admin/service_role possono scriverli.
  const supabase = supabaseAdmin();

  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, email, accordo_path, accordo_verificato, accordo_approvato_admin_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      email: string;
      accordo_path: string | null;
      accordo_verificato: string | null;
      accordo_approvato_admin_at: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.accordo_path) return errore("Questo partecipante non ha ancora caricato l'accordo.");
  if (target.accordo_approvato_admin_at) {
    return errore("Accordo già approvato: la verifica non serve più.");
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(target.accordo_path);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const nome = target.full_name ?? target.email;
  const modello = await caricaModelloAttivo();

  const verifica = await verificaAccordoFirmato({
    pdfBase64: buffer.toString("base64"),
    mimeType: blob.type || "application/pdf",
    modelloBase64: modello?.base64,
    modelloMimeType: modello?.mimeType,
  });
  const nota =
    verifica.esito === "non_valutato" && !modello
      ? "Nessun modello di riferimento caricato: carica prima il modello dell'accordo."
      : verifica.note;

  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_verificato: verifica.esito,
      accordo_verifica_note: nota || null,
      accordo_verificato_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) return errore(error.message);

  // Traccia la rivalutazione: un esito riscritto senza riga nel registro
  // sarebbe indistinguibile da un esito mai cambiato, proprio dove invece
  // serve capire cosa è successo a quel documento.
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "rivalutazione_ia_accordo",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: nome,
        esito_precedente: target.accordo_verificato,
        esito: verifica.esito,
        note: nota,
      },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: { esito: verifica.esito, note: nota } };
}

/**
 * L'accesso globale registra la PROPRIA verifica dell'accordo, quando il
 * controllo automatico non ha potuto valutarlo (modello sovraccarico, errore
 * di rete, servizio non raggiungibile) o quando resta il dubbio.
 *
 * Perché esiste: l'esito dell'IA non è mai la decisione — lo dice la stessa
 * informativa privacy — la decisione è umana, e la firma sul controllo è di
 * chi ha accesso globale. Senza questa via, un servizio esterno sovraccarico
 * bloccherebbe l'ingresso di persone vere con un documento già perfetto.
 *
 * Il motivo è OBBLIGATORIO e resta scritto, insieme all'esito automatico
 * mancato: la nota deve spiegare da sola perché quella riga è "ok" senza
 * essere passata dall'IA, altrimenti il primo che la legge più tardi pensa
 * a un controllo automatico che non c'è stato.
 */
export async function verificaManualeAccordo(
  userId: string,
  motivoGrezzo: string,
): Promise<Esito<{ esito: string; note: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const motivo = motivoGrezzo.trim();
  if (motivo.length < 10) {
    return errore(
      "Scrivi che cosa hai controllato (almeno qualche parola): resta nel registro come tua firma sul controllo.",
    );
  }

  // Scrive col service_role: i campi accordo_* sono protetti dal trigger
  // fn_protect_profile (0103) — solo admin/service_role possono scriverli.
  const supabase = supabaseAdmin();

  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, email, accordo_path, accordo_verificato, accordo_approvato_admin_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      email: string;
      accordo_path: string | null;
      accordo_verificato: string | null;
      accordo_approvato_admin_at: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.accordo_path) return errore("Questo partecipante non ha ancora caricato l'accordo.");
  if (target.accordo_approvato_admin_at) {
    return errore("Accordo già approvato: la verifica non serve più.");
  }

  const nome = target.full_name ?? target.email;
  // Il punto finale del motivo viene tolto: la nota lo aggiunge da sé, e un
  // "firma presente.." nel pannello si nota subito.
  const nota =
    `Verifica a mano dell'accesso globale: ${motivo.replace(/\.+$/, "")}. ` +
    `(Controllo automatico non disponibile: ${target.accordo_verificato ?? "mai eseguito"}.)`;

  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_verificato: "ok",
      accordo_verifica_note: nota,
      accordo_verificato_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) return errore(error.message);

  // Questa riga è più importante di tutte le altre: dice che l'accesso
  // globale ha controllato il documento di persona, e con quale motivo.
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "verifica_manuale_accordo",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: nome,
        motivo,
        esito_automatico_mancato: target.accordo_verificato,
      },
    }),
  );

  revalidatePath("/admin");
  return { ok: true, dati: { esito: "ok", note: nota } };
}

/**
 * Manda al Titolare, sulla propria casella, la copia dell'accordo firmato da
 * un Collaboratore: la stessa che parte da sola quando la PEC non riesce
 * (condivide la formulazione, vedi inviaAccordoAgliAmministratori). Serve
 * per la controfirma a mano — il PDF va stampato, firmato e scansionato — e
 * senza questa copia l'unica via era chiedere di nuovo il file alla persona.
 *
 * Il destinatario è SEMPRE chi chiede, mai un indirizzo indicato dal client:
 * questa azione non è un canale per spedire documenti altrui dove capita.
 * Il messaggio non dichiara un guasto della PEC che non c'è: l'avviso sulla
 * data certa resta nel solo ripiego automatico, dove la PEC è davvero
 * caduta.
 */
export async function inviaAccordoFirmatoPerEmail(
  userId: string,
): Promise<Esito<{ destinatario: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const supabase = supabaseAdmin();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, email, accordo_path")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      email: string;
      accordo_path: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.accordo_path) return errore("Questo partecipante non ha ancora caricato l'accordo.");

  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(target.accordo_path);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const nome = target.full_name ?? target.email;
  const inviata = await inviaAccordoAgliAmministratori({
    actorId: profile.id,
    actorRole: profile.role,
    entityId: target.id,
    buffer: Buffer.from(await blob.arrayBuffer()),
    nomeFile: nomeFileUmano(target.accordo_path),
    contentType: blob.type || "application/pdf",
    nome,
    avvisoDataCerta: false,
    azione: "accordo_inviato_per_email",
    motivo: "copia richiesta dall'accesso globale per la controfirma",
  });
  if (!inviata) {
    return errore(
      "Invio non riuscito: sul server mancano o non funzionano le credenziali email (MAIL_USER/MAIL_PASS).",
    );
  }

  revalidatePath("/admin");
  return { ok: true, dati: { destinatario: profile.email } };
}

/** Esito di un controllo d'integrità, come lo racconta la funzione nel database. */
export type EsitoControlloIntegrita = {
  esito: string;
  deliverable_controllate: number;
  versioni_controllate: number;
  catene_rotte: number;
  pacchetti_controllati: number;
  manifesti_rotti: number;
  file_mancanti: number;
  file_dimensione_diversa: number;
};

/**
 * Lancia a mano il controllo d'integrità dei depositi.
 *
 * Il controllo gira da solo ogni notte (migrazione 0138, sveglia nel
 * database): questo pulsante non lo sostituisce, serve a poterlo chiedere
 * ADESSO — prima di pubblicare, o dopo una segnalazione. La funzione nel
 * database scrive comunque l'esito nel proprio registro, con origine
 * 'manuale', così resta traccia anche di chi l'ha chiesto e quando.
 */
export async function eseguiControlloIntegrita(): Promise<Esito<EsitoControlloIntegrita>> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  // Col service_role: il registro dei controlli non ha policy di scrittura
  // (lo scrive solo la funzione) e la funzione stessa è riservata.
  const { data, error } = await supabaseAdmin().rpc("controlla_integrita", {
    p_origine: "manuale",
  });
  if (error) return errore(error.message);

  revalidatePath("/admin");
  return { ok: true, dati: data as EsitoControlloIntegrita };
}

/**
 * Registra il documento di rinnovo dell'accordo editoriale (Art. 9.1):
 * il Collaboratore firma e carica il rinnovo con la stessa modalità del
 * primo accordo; l'approvazione del Coordinatore (approvaRinnovoAccordo)
 * riattiva l'accesso e sposta la scadenza di 6 mesi avanti. Niente spunta
 * "ho letto e compreso" (non è la prima lettura) né controlli anagrafici
 * (già fatti col primo accordo), e niente PEC: la certificazione con data
 * certa copre l'accordo iniziale nel registro dei partecipanti. La copia
 * di sicurezza su Drive va in "Gestione canale/rinnovi" (accanto agli
 * accordi), così l'archivio resta ordinato.
 */
export async function caricaRinnovoAccordo(
  storagePath: string,
  _sha256Client: string,
): Promise<Esito<{ sha256: string }>> {
  const { profile } = await requireSession();

  // Scrive col service_role: i campi rinnovo_* sono protetti dal trigger
  // fn_protect_profile (0111) — solo admin/service_role possono scriverli.
  const supabase = supabaseAdmin();

  // Il path deve stare nello spazio di chi chiama: impedisce di far puntare
  // il proprio profilo al file di qualcun altro (stesso pattern di caricaAccordo).
  if (!storagePath.startsWith(`${profile.id}/rinnovo/`)) {
    return errore("Percorso del file non valido.");
  }

  // Difesa in profondità: si rinnova SOLO un accordo già firmato e approvato.
  if (!profile.accordo_path || !profile.accordo_approvato_admin_at) {
    return errore("Nessun accordo approvato da rinnovare.");
  }

  const { data: blob, error: eBlob } = await supabase.storage
    .from("profili")
    .download(storagePath);
  if (eBlob || !blob) {
    return errore("File non leggibile dallo storage.");
  }

  // L'impronta è quella VERA del file appena scaricato, ricalcolata qui —
  // mai quella dichiarata dal client (stesso motivo di caricaAccordo).
  const buffer = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error } = await supabase
    .from("profiles")
    .update({
      rinnovo_path: storagePath,
      rinnovo_sha256: sha256,
      rinnovo_caricato_at: new Date().toISOString(),
    })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  // Copia di sicurezza su Drive in "Gestione canale/rinnovi/<polo>/". La
  // data nel nome distingue un rinnovo dal successivo. Best-effort: se
  // fallisce, il rinnovo resta comunque nel gestionale.
  const nome = (profile.full_name ?? "rinnovo").replace(/[/\\:*?"<>|]/g, "_");
  const nomeSuDrive = `${nome} - rinnovo ${new Date().toISOString().slice(0, 10)}.pdf`;
  const { data: membriPoli } = await supabase
    .from("memberships")
    .select("poli!inner(nome)")
    .eq("user_id", profile.id);
  // "poli!inner(nome)" incorpora un OGGETTO singolo per riga (ogni membership
  // appartiene a un solo polo), non un array: un .flatMap(m.poli.map(...))
  // qui lanciava "m.poli.map is not a function" alla prima esecuzione reale
  // (verificato empiricamente) — mai scattato prima perché non si era mai
  // arrivati fin qui con dati veri.
  const membri = (membriPoli ?? []) as unknown as { poli: { nome: string } }[];
  const poliUtente = membri.map((m) => m.poli.nome);
  await ignora(archiviaAccordoSuDrive(buffer, nomeSuDrive, poliUtente, "rinnovi"));

  // Avviso immediato: c'è un documento di rinnovo da approvare.
  await inviaPushAdmin({
    title: "Rinnovo da approvare — ToothTalk",
    body: `${profile.full_name ?? profile.email} ha caricato il documento di rinnovo.`,
    url: "/admin",
  });

  revalidatePath("/rinnovo");
  revalidatePath("/profilo");
  return { ok: true, dati: { sha256 } };
}

/** Genera un URL firmato per scaricare una ricevuta di consenso (admin only). */
/**
 * Carica il MODELLO dell'accordo editoriale (lato admin): il documento
 * che viene inviato ai collaboratori per la firma. Ogni caricamento è una
 * NUOVA riga in modello_accordo (storico append-only in pratica); il
 * modello attivo è l'ultima riga. L'impronta SHA-256 è ricalcolata
 * lato server, mai fidarsi del valore dichiarato dal client.
 */

export async function caricaModelloAccordo(
  storagePath: string,
): Promise<Esito<{ id: string }>> {
  const { profile } = await requireSession();
  if (profile.role !== "admin") return errore("Solo chi ha accesso globale può caricare il modello.");

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
 * e manda il MODELLO dell'accordo da firmare, con l'accesso globale in copia.
 *
 * Due canali, due scopi diversi: la PEC entra in coda e darà la data certa
 * appena il computer la spedisce; l'email dalla casella del progetto parte
 * subito, perché la persona deve poter firmare oggi — non fra un giorno.
 * Prima di approvare serve aver caricato il modello (caricaModelloAccordo).
 */
export async function approvaRegistrazione(
  userId: string,
  onScreenConfermato: boolean,
): Promise<Esito<{ inCoda: string | null; viaGmail: boolean }>> {
  const { profile: admin } = await requireSession();
  if (admin.role !== "admin") return errore("Solo chi ha accesso globale può approvare registrazioni.");

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

  const { data: blobModello, error: eBlob } = await supabase.storage
    .from("finali")
    .download(modello.storage_path);
  if (eBlob || !blobModello) return errore("Impossibile leggere il modello dell'accordo.");
  const bufferModello = Buffer.from(await blobModello.arrayBuffer());
  const nomeModello = nomeFileUmano(modello.storage_path);
  const nome = richiedente.full_name ?? richiedente.email;

  // Il Protocollo Operativo viene allegato automaticamente all'email con
  // l'accordo da firmare: l'incorporazione per richiamo (Protocollo Art.
  // 13.1) vale solo se il documento è materialmente consegnato PRIMA della
  // firma. Il file arriva dal filesystem del deploy (public/documenti/), la
  // stessa fonte dei PDF ufficiali che il Titolare aggiorna ad ogni modifica.
  let protocolloPdf: Buffer;
  try {
    protocolloPdf = readFileSync(
      join(process.cwd(), "public", "documenti", "3-protocollo-operativo.pdf"),
    );
  } catch {
    return errore(
      "Impossibile allegare il Protocollo Operativo: file public/documenti/3-protocollo-operativo.pdf non leggibile dal server. Correggi prima di approvare la registrazione.",
    );
  }

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

  const oggettoAccordo = `[ToothTalk] Benvenuto/a in ToothTalk — un ultimo passo prima di partire`;
  const testoAccordo = [
    "",
    `Ciao ${nome}, benvenuto/a in ToothTalk!`,
    "",
    "La tua registrazione è stata approvata: da oggi fai parte del progetto,",
    "e non vediamo l'ora di iniziare a lavorare insieme.",
    "",
    "Un solo passaggio prima di partire: in allegato trovi l'accordo",
    "editoriale e il Protocollo Operativo ad esso allegato. Leggili con",
    "calma, firma l'accordo e ricaricalo dal tuo profilo nel gestionale",
    "(sezione \"Accordo editoriale\").",
    "",
    "Al momento del caricamento ti verrà chiesto di confermare di averlo",
    "letto e compreso: quella conferma, insieme all'accordo firmato, ti",
    "arriverà a sua volta via PEC con data certa — così hai sempre traccia",
    "di tutto.",
    "",
    "Se hai domande o dubbi, scrivici pure: siamo qui per questo.",
    "",
    "A presto,",
    "il team ToothTalk™",
    "",
    "Messaggio generato automaticamente dal gestionale ToothTalk.",
    "",
  ].join("\n");
  const htmlAccordo = `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <h1 style="font-size:20px;margin:4px 0 12px">Benvenuto/a in ToothTalk 🦷</h1>
  <p style="font-size:13px;line-height:1.6">
    Ciao <strong>${nome}</strong>, la tua registrazione è stata approvata: da oggi
    fai parte del progetto, e non vediamo l'ora di iniziare a lavorare insieme.
  </p>
  <p style="font-size:13px;line-height:1.6">
    Un solo passaggio prima di partire: in allegato trovi l'accordo editoriale
    e il Protocollo Operativo ad esso allegato. Leggili con calma, firma
    l'accordo e ricaricalo dal tuo profilo nel gestionale.
  </p>
  <p style="font-size:12px;color:#666">
    Al caricamento ti verrà chiesto di confermare di averlo letto e compreso:
    quella conferma, insieme all'accordo firmato, ti arriverà a sua volta via
    PEC con data certa — così hai sempre traccia di tutto.
  </p>
  <p style="font-size:13px;line-height:1.6;margin-top:16px">
    Se hai domande o dubbi, scrivici pure: siamo qui per questo.<br>
    A presto,<br>il team ToothTalk™
  </p>
</div>`;
  const allegatiAccordo = [
    { filename: nomeModello, content: bufferModello, contentType: "application/pdf" },
    { filename: "3-protocollo-operativo.pdf", content: protocolloPdf, contentType: "application/pdf" },
  ];

  // Le impronte servono allo script per verificare, al momento della
  // spedizione, che siano ancora questi due file: i documenti del progetto
  // possono essere aggiornati nel frattempo, e certificare la versione nuova
  // al posto di quella consegnata sarebbe un falso.
  const shaModello = createHash("sha256").update(bufferModello).digest("hex");
  const shaProtocollo = createHash("sha256").update(protocolloPdf).digest("hex");

  try {
    const { id: inCoda } = await accodaPec({
      oggetto: oggettoAccordo,
      testo: testoAccordo,
      html: htmlAccordo,
      allegati: [
        { nome: nomeModello, bucket: "finali", percorso: modello.storage_path, sha256: shaModello },
        { nome: "3-protocollo-operativo.pdf", file_pubblico: "3-protocollo-operativo.pdf", sha256: shaProtocollo },
      ],
      // "to": la persona — PEC se presente, altrimenti la sua email di
      // accesso (la PEC non è più obbligatoria per partecipare).
      destinatari: [richiedente.pec ?? richiedente.email],
      copiaConoscenza: destinatariPecGlobali(), // "cc": accesso globale
    });

    // Il documento parte subito anche per email: una PEC in coda non è ancora
    // una consegna, e senza il modello nessuno può firmare.
    const inviataViaGmail = await inviaEmailGmail({
      destinatario: richiedente.email,
      oggetto: oggettoAccordo,
      testo: testoAccordo,
      html: htmlAccordo,
      allegati: allegatiAccordo,
    });

    revalidatePath("/admin");
    return { ok: true, dati: { inCoda, viaGmail: inviataViaGmail } };
  } catch (e) {
    // La coda non ha accettato la riga: la PEC non esiste da nessuna parte.
    // Il profilo viene segnato (accordo_pec_fallita_at) per poterlo ritrovare
    // e rimettere in coda da "Accordi da certificare"; intanto lo stesso
    // documento parte per email, così la persona non resta bloccata in attesa
    // di un accordo che non arriva mai.
    await ignora(
      supabaseAdmin()
        .from("profiles")
        .update({ accordo_pec_fallita_at: new Date().toISOString() })
        .eq("id", userId),
    );
    const inviataViaGmail = await inviaEmailGmail({
      destinatario: richiedente.email,
      oggetto: oggettoAccordo,
      testo: testoAccordo,
      html: htmlAccordo,
      allegati: allegatiAccordo,
    });
    if (!inviataViaGmail) {
      // Nessuno dei due canali è partito: l'account resta approvato (sopra) ma
      // il documento non è arrivato a nessuno. Il profilo è già segnato qui
      // sopra, quindi la persona compare fra quelle da certificare: senza
      // quella riga un accordo non consegnato passerebbe inosservato.
      return errore(
        `Account approvato ma né PEC né email sono partite: ${e instanceof Error ? e.message : "errore di accodamento"}`,
      );
    }
    revalidatePath("/admin");
    return { ok: true, dati: { inCoda: null, viaGmail: true } };
  }
}

/**
 * Rimette in coda la PEC di un deposito rimasto senza: l'accordo firmato che la
 * persona ha caricato, con la sua sola firma.
 *
 * Serve per i depositi che sono arrivati mentre Aruba bloccava gli invii (o
 * mentre la coda non accettava la riga): la PEC che sarebbe partita al
 * caricamento non è mai partita, e quindi la firma di quella persona non ha
 * data certa. Il documento non si tocca: si rimanda ESATTAMENTE quello che ha
 * caricato, con la sua impronta.
 *
 * La conferma è obbligatoria e resta nel registro: si certifica solo un
 * documento che qualcuno ha guardato. L'esito automatico non è una decisione —
 * per Eugenia diceva "una pagina su nove" e nessuno deve mandarla in coda.
 *
 * Idempotente: se quel documento ha già una PEC in coda o spedita, non ne
 * accoda una seconda (due certificazioni dello stesso file non servono).
 */
export async function mettiInCodaPecDeposito(
  userId: string,
  conferma: string,
): Promise<Esito<{ inCoda: string | null; giaFatta: boolean }>> {
  const { isAdmin, profile: admin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const pulita = conferma.trim();
  if (pulita.length < 10) {
    return errore(
      "Scrivi che cosa hai controllato nel documento (almeno una frase): resta nel registro insieme al tuo nome.",
    );
  }

  const adminDb = supabaseAdmin();
  const { data: target } = await adminDb
    .from("profiles")
    .select("id, full_name, email, pec, accordo_path, accordo_sha256, accordo_approvato_admin_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      email: string;
      pec: string | null;
      accordo_path: string | null;
      accordo_sha256: string | null;
      accordo_approvato_admin_at: string | null;
    }>();
  if (!target) return errore("Profilo non trovato.");
  if (!target.accordo_path || !target.accordo_sha256) {
    return errore(
      "Questa persona non ha caricato nessun accordo: non c'è niente da certificare. Se l'aveva fatto, chiedile di caricarlo di nuovo.",
    );
  }

  // Lo stesso documento non si certifica due volte: si cercano le PEC di
  // QUESTA persona e si guarda se una porta già l'impronta del suo accordo. Il
  // filtro sull'impronta non si fa in SQL (il confronto dentro il JSONB con la
  // libreria produceva un filtro non valido, e l'errore finiva per sembrare
  // "non c'è niente"): si leggono le righe della persona — poche — e si guarda
  // qui. Se la lettura fallisce NON si tira dritto: meglio un errore chiaro che
  // una seconda PEC sullo stesso documento.
  const { data: pecDellaPersona, error: eControllo } = await adminDb
    .from("pec_da_inviare")
    .select("id, stato, allegati")
    .in("stato", ["in_coda", "inviata"])
    .filter("contesto->>profile_id", "eq", userId);
  if (eControllo) {
    return errore(
      `Non sono riuscito a controllare se questo documento ha già la sua PEC: ${eControllo.message}. Riprova, o guarda la coda nel Registro.`,
    );
  }
  const giaCertificato = (pecDellaPersona ?? []).find((r) =>
    ((r.allegati ?? []) as { sha256?: string }[]).some((a) => a.sha256 === target.accordo_sha256),
  );
  if (giaCertificato) {
    return { ok: true, dati: { inCoda: giaCertificato.id as string, giaFatta: true } };
  }

  const nome = target.full_name ?? target.email;
  const nomeFile = nomeFileUmano(target.accordo_path);
  const destinatariGlobali = destinatariPecGlobali();
  const copiaPersona = target.pec ?? target.email;

  try {
    const { id: inCoda } = await accodaPec({
      destinatari: destinatariGlobali,
      ...messaggioDepositoAccordo({ nome, sha256: target.accordo_sha256 }),
      allegati: [
        { nome: nomeFile, bucket: "profili", percorso: target.accordo_path, sha256: target.accordo_sha256 },
      ],
      copiaConoscenza: destinatariGlobali.includes(copiaPersona) ? undefined : [copiaPersona],
      contesto: { tipo: "deposito", profile_id: userId },
    });

    await ignora(
      adminDb.from("audit_log").insert({
        actor: admin.id,
        actor_role: admin.role,
        action: "pec_deposito_messa_in_coda",
        entity_type: "profile",
        entity_id: userId,
        meta: {
          utente: target.full_name,
          conferma: pulita,
          sha256: target.accordo_sha256,
          accordo_approvato_admin_at: target.accordo_approvato_admin_at,
        },
      }),
    );

    revalidatePath("/admin");
    return { ok: true, dati: { inCoda, giaFatta: false } };
  } catch (e) {
    return errore(`PEC non entrata in coda: ${e instanceof Error ? e.message : "errore di accodamento"}`);
  }
}

/**
 * Chiede alla persona di ricaricare l'accordo (solo accesso globale).
 *
 * Nasce da un caso vero: un accordo caricato con una pagina sola su nove,
 * marcato "sembra non corretto" dal controllo automatico — e nessun modo di
 * dirlo alla persona se non scrivendole fuori dal gestionale, senza che ne
 * restasse traccia.
 *
 * Il motivo è obbligatorio: lo legge la persona nel proprio profilo e resta nel
 * registro insieme a chi l'ha chiesto. La richiesta non blocca e non sblocca
 * niente — sull'accordo la decisione è umana, e l'esito automatico non decide
 * mai. Dice soltanto che quella persona è stata avvisata, e di che cosa. Si
 * chiude da sola al primo accordo nuovo che arriva (caricaAccordo), perché il
 * ricaricamento È la risposta.
 */
export async function chiediRicaricamentoAccordo(
  userId: string,
  motivo: string,
): Promise<Esito<{ emailPartita: boolean }>> {
  const { isAdmin, profile: admin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const pulito = motivo.trim();
  if (pulito.length < 10) {
    return errore(
      "Scrivi che cosa deve correggere la persona (almeno una frase): lo legge lei, e resta nel registro.",
    );
  }

  // Scrive col service_role: i campi accordo_* sono protetti dal trigger
  // fn_protect_profile (0103/0140) — solo admin/service_role possono scriverli.
  const adminDb = supabaseAdmin();
  const { data: target } = await adminDb
    .from("profiles")
    .select("id, full_name, email, accordo_path")
    .eq("id", userId)
    .single<{ id: string; full_name: string | null; email: string; accordo_path: string | null }>();
  if (!target) return errore("Profilo non trovato.");
  if (!target.accordo_path) {
    return errore("Questa persona non ha ancora caricato un accordo: non c'è niente da ricaricare.");
  }

  const ora = new Date().toISOString();
  const { error } = await adminDb
    .from("profiles")
    .update({ accordo_ricarica_richiesta_at: ora, accordo_ricarica_motivo: pulito })
    .eq("id", userId);
  if (error) return errore(error.message);

  const nome = target.full_name ?? target.email;
  // L'esito dell'email si registra: se non parte, la persona non sa niente
  // della richiesta e va avvisata in un altro modo. Senza questa traccia non
  // c'era modo di saperlo ("è partita l'email?" era una domanda senza risposta).
  const emailPartita = await inviaEmailGmail({
    destinatario: target.email,
    oggetto: "[ToothTalk] Il tuo accordo firmato va ricaricato",
    testo: [
      "",
      `Ciao ${nome},`,
      "",
      "l'accordo editoriale firmato che ci hai mandato ha bisogno di essere",
      "ricaricato:",
      "",
      `  ${pulito}`,
      "",
      "Puoi ricaricarlo dal tuo profilo, sezione \"Accordo editoriale\". Serve il",
      "documento firmato e leggibile per intero: tutte le pagine, con la firma.",
      "",
      "Quando lo ricarichi, questa richiesta si chiude da sola e non devi fare",
      "altro. Se hai dubbi, rispondi a questa email e te lo spieghiamo.",
      "",
      "— ToothTalk™",
      "",
    ].join("\n"),
    html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="font-size:13px;line-height:1.6">Ciao <strong>${esc(nome)}</strong>,</p>
  <p style="font-size:13px;line-height:1.6">
    l&apos;accordo editoriale firmato che ci hai mandato <strong>ha bisogno di essere
    ricaricato</strong>:
  </p>
  <p style="margin:12px 0;padding:10px 12px;background:#f6f7f9;border-radius:10px;font-size:13px;line-height:1.6">
    ${esc(pulito)}
  </p>
  <p style="font-size:13px;line-height:1.6">
    Puoi ricaricarlo dal tuo profilo, sezione &quot;Accordo editoriale&quot;. Serve il
    documento firmato e leggibile per intero: tutte le pagine, con la firma.
  </p>
  <p style="font-size:12px;color:#666">
    Quando lo ricarichi, questa richiesta si chiude da sola. Se hai dubbi, rispondi a
    questa email e te lo spieghiamo.
  </p>
  <p style="font-size:13px;line-height:1.6;margin-top:16px">— ToothTalk™</p>
</div>`,
  });

  await ignora(
    adminDb.from("audit_log").insert({
      actor: admin.id,
      actor_role: admin.role,
      action: "richiesta_ricaricamento_accordo",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: target.full_name,
        motivo: pulito,
        email: target.email,
        email_partita: emailPartita,
      },
    }),
  );

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return { ok: true, dati: { emailPartita } };
}

/**
 * Rimette in coda la PEC dell'accordo di chi lo ha ricevuto solo via email
 * (accordo_pec_fallita_at valorizzato: la PEC non è mai arrivata a
 * destinazione — o perché Aruba bloccava gli invii, o perché la coda non ha
 * accettato la riga). Stesso documento, stesso modello attivo: serve a dare
 * data certa a una consegna che non l'ha avuta.
 *
 * Idempotente: se la PEC di questa persona è già in coda non ne aggiunge una
 * seconda — due PEC identiche sarebbero due certificazioni dello stesso
 * documento, e la seconda non serve a nessuno.
 */
export async function ricertificaAccordoPec(
  userId: string,
): Promise<Esito<{ inCoda: string | null; giaInCoda: boolean }>> {
  const { profile: admin } = await requireSession();
  if (admin.role !== "admin") return errore("Solo chi ha accesso globale può ricertificare.");

  const supabase = await supabaseServer();

  const { data: modello } = await supabase
    .from("modello_accordo")
    .select("storage_path")
    .order("caricato_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ storage_path: string }>();
  if (!modello) return errore("Nessun modello di accordo caricato.");

  const { data: richiedente } = await supabase
    .from("profiles")
    .select("full_name, email, pec, accordo_pec_fallita_at")
    .eq("id", userId)
    .single<{ full_name: string | null; email: string; pec: string | null; accordo_pec_fallita_at: string | null }>();
  if (!richiedente) return errore("Profilo non trovato.");
  if (!richiedente.accordo_pec_fallita_at) {
    return errore("Questo profilo non ha nessuna PEC in sospeso da ricertificare.");
  }

  // Se la PEC di questa persona è già in coda, non se ne accoda una seconda:
  // la certificazione del documento è una sola. Se il controllo non riesce si
  // torna un errore: non si tira dritto sperando che vada bene.
  const { data: codaEsistente, error: eCoda } = await supabaseAdmin()
    .from("pec_da_inviare")
    .select("id")
    .eq("stato", "in_coda")
    .filter("contesto->>profile_id", "eq", userId)
    .limit(1);
  if (eCoda) {
    return errore(`Non sono riuscito a controllare la coda: ${eCoda.message}. Riprova.`);
  }
  if (codaEsistente?.length) {
    return { ok: true, dati: { inCoda: codaEsistente[0].id as string, giaInCoda: true } };
  }

  const { data: blobModello, error: eBlob } = await supabase.storage
    .from("finali")
    .download(modello.storage_path);
  if (eBlob || !blobModello) return errore("Impossibile leggere il modello dell'accordo.");
  const bufferModello = Buffer.from(await blobModello.arrayBuffer());
  const nomeModello = nomeFileUmano(modello.storage_path);
  const nome = richiedente.full_name ?? richiedente.email;

  let protocolloPdf: Buffer;
  try {
    protocolloPdf = readFileSync(join(process.cwd(), "public", "documenti", "3-protocollo-operativo.pdf"));
  } catch {
    return errore("Impossibile allegare il Protocollo Operativo: file non leggibile dal server.");
  }

  const shaModello = createHash("sha256").update(bufferModello).digest("hex");
  const shaProtocollo = createHash("sha256").update(protocolloPdf).digest("hex");

  try {
    const { id: inCoda } = await accodaPec({
      oggetto: `[ToothTalk] Ricertificazione PEC — stesso accordo già ricevuto via email`,
      testo: [
        "",
        `Ciao ${nome},`,
        "",
        "Ti avevamo già mandato l'accordo editoriale via email normale. Te lo",
        "rimandiamo in allegato con data certa: è lo stesso identico documento",
        "di prima — con la PEC ha la data e l'ora della consegna.",
        "",
        "Se l'hai già firmato e ricaricato dal tuo profilo, non devi fare nulla.",
        "",
        "— ToothTalk™",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="font-size:13px;line-height:1.6">Ciao <strong>${esc(nome)}</strong>,</p>
  <p style="font-size:13px;line-height:1.6">
    Ti avevamo già mandato l'accordo editoriale via email normale. Te lo
    rimandiamo in allegato con <strong>data certa</strong>: è lo stesso
    identico documento di prima — con la PEC ha la data e l'ora della consegna.
  </p>
  <p style="font-size:12px;color:#666">
    Se l'hai già firmato e ricaricato dal tuo profilo, non devi fare nulla.
  </p>
  <p style="font-size:13px;line-height:1.6;margin-top:16px">— ToothTalk™</p>
</div>`,
      allegati: [
        { nome: nomeModello, bucket: "finali", percorso: modello.storage_path, sha256: shaModello },
        { nome: "3-protocollo-operativo.pdf", file_pubblico: "3-protocollo-operativo.pdf", sha256: shaProtocollo },
      ],
      destinatari: [richiedente.pec ?? richiedente.email],
      copiaConoscenza: destinatariPecGlobali(),
      // La marcatura si toglie quando la PEC è DAVVERO partita, e lo fa lo
      // script: finché è in coda la persona resta fra quelle da certificare,
      // perché è ancora vero che quella consegna non ha data certa.
      contesto: { tipo: "ricertificazione", profile_id: userId },
    });

    revalidatePath("/admin");
    return { ok: true, dati: { inCoda, giaInCoda: false } };
  } catch (e) {
    return errore(`PEC non entrata in coda: ${e instanceof Error ? e.message : "errore di accodamento"}`);
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
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("profiles")
    .update({ on_screen: appare })
    .eq("id", userId);
  if (error) return errore(error.message);

  // Traccia il cambio (chi, quando, nuovo valore) nella catena di audit.
  // L'audit si scrive col service_role: la policy di insert è stata rimossa
  // (0115) — il registro probatorio lo scrive solo il server.
  await ignora(
    supabaseAdmin().from("audit_log").insert({
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
  const dataNascitaIt = soloData(c.data_nascita);
  const dataSottoscrizioneIt = c.accordo_caricato_at
    ? soloData(c.accordo_caricato_at)
    : "—";
  const dataApprovazioneIt = dataOra(approvatoAt);

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
trattamento e Coordinatore del progetto editoriale &quot;Tooth Talk™&quot;,</p>

<h2>DICHIARA E NOMINA</h2>

<p>Il/la Collaboratore/trice <strong>${esc(nome)}</strong>, nato/a a ${esc(c.luogo_nascita)} il ${dataNascitaIt},
C.F. ${esc(c.codice_fiscale)}, avendo sottoscritto in data ${dataSottoscrizioneIt} l'Accordo
Editoriale per la collaborazione volontaria al Progetto &quot;Tooth Talk™&quot;, quale persona
autorizzata al trattamento dei dati personali ai sensi dell'art. 29 del Regolamento (UE) 2016/679
(GDPR) e dell'art. 2-quaterdecies del D.Lgs. 196/2003 e s.m.i. (Codice Privacy), sotto l'autorità
e le istruzioni documentate del Titolare del trattamento.</p>

<h2>Ambito dell'autorizzazione</h2>
<ul>
  <li>Raccolta dei recapiti (email o PEC) dei soggetti esterni intervistati, mediante apposito video di dichiarazione autonomo registrato prima di ogni intervista (Art. 4.1 del Protocollo Operativo);</li>
  <li>Inserimento immediato di tali recapiti nel gestionale del Progetto, che provvede autonomamente all'invio, alla raccolta della firma digitale e alla conservazione delle liberatorie;</li>
  <li><strong>Custodia temporanea del materiale grezzo (file video/audio) esclusivamente per il tempo strettamente necessario al caricamento sul gestionale (entro 48-72 ore dalla ripresa, e comunque non oltre 48 ore dalla conferma di avvenuto caricamento).</strong></li>
</ul>

<p>Il Collaboratore, nell'esercizio della presente autorizzazione, non ha alcuna autonomia
decisionale sulle finalità e sui mezzi del trattamento, ed è tenuto a:</p>
<ul>
  <li>Non raccogliere, non custodire e non trasmettere alcun documento cartaceo contenente dati personali degli intervistati, in nessuna circostanza;</li>
  <li>Inserire i recapiti nel gestionale immediatamente dopo la registrazione;</li>
  <li>Non condividere i dati raccolti (recapiti, video, audio) con altri Collaboratori o terzi al di fuori del caricamento diretto sul gestionale;</li>
  <li><strong>Cancellare la copia locale del materiale grezzo subito dopo la conferma di avvenuto caricamento, e comunque entro 48 ore dalla ricezione della conferma;</strong></li>
  <li>Mantenere il proprio dispositivo protetto da blocco schermo/PIN e, ove possibile, da crittografia del volume;</li>
  <li>Comunicare al Coordinatore, senza indugio, qualsiasi violazione dei dati personali di cui venga a conoscenza nello svolgimento delle proprie attività.</li>
</ul>

<h2>Durata dell'autorizzazione</h2>
<p>La presente nomina ha effetto per tutta la durata della collaborazione con il Progetto
&quot;Tooth Talk™&quot;, come definita dall'Accordo Editoriale, e può essere revocata in qualsiasi
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
        `Ciao ${nome},\n\nIl tuo accordo editoriale è stato approvato. Il Coordinatore ha ` +
        `contestualmente generato il tuo Modulo di nomina a persona autorizzata al ` +
        `trattamento dei dati (Documento 4): lo trovi nel tuo profilo sul gestionale, ` +
        `sezione "Accordo editoriale".\n\nNon devi fare nulla: è un documento a tua ` +
        `disposizione per conoscenza e conservazione.\n\n— ToothTalk™`,
    }),
  );

  return { ok: true };
}

/**
 * Il Titolare carica la scansione della copia cartacea dell'Accordo firmata
 * da ENTRAMBE le parti (controfirma a mano): sostituisce il vecchio click
 * "Approva accordo" con un upload tracciato, non più un'azione senza
 * documento. Stesse precondizioni di prima (accordo del collaboratore già
 * caricato e non ancora approvato). Solo admin.
 *
 * NON genera ancora il Modulo di nomina (Documento 4): quella è la QUINTA
 * condizione, legata solo alla conferma del Collaboratore
 * (confermaControfirmaAccordo, 0118) — non a questo caricamento.
 */
export async function caricaControfirmaAccordo(
  userId: string,
  storagePath: string,
  _sha256Client: string,
): Promise<Esito<{ approvatoAt: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const supabase = await supabaseServer();

  // Controllo di coerenza: si controfirma solo un accordo che esiste e non
  // è già stato approvato (stesse precondizioni di prima).
  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, email, pec, accordo_path, accordo_letto_confermato, accordo_verificato, accordo_approvato_admin_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      email: string;
      pec: string | null;
      accordo_path: string | null;
      accordo_letto_confermato: boolean;
      accordo_verificato: string | null;
      accordo_approvato_admin_at: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.accordo_path) return errore("Nessun accordo caricato per questo utente.");
  if (target.accordo_approvato_admin_at) return errore("Accordo già approvato.");

  // Il path deve stare nello spazio del collaboratore di cui si carica la
  // controfirma (stesso principio di caricaAccordo).
  if (!storagePath.startsWith(`controfirma/${userId}/`)) {
    return errore("Percorso del file non valido.");
  }

  // Il file si rilegge dallo storage (mai quello indicato dal client) e se ne
  // ricalcola l'impronta qui: è quella che andrà certificata via PEC.
  const { data: blob, error: eBlob } = await supabase.storage.from("finali").download(storagePath);
  if (eBlob || !blob) return errore("File non leggibile dallo storage.");

  const nomeFile = nomeFileUmano(storagePath);
  const buffer = Buffer.from(await blob.arrayBuffer());
  const nome = target.full_name ?? target.email;

  // L'impronta certificata via PEC è quella VERA del file appena scaricato,
  // ricalcolata qui — mai quella dichiarata dal client (stesso principio di
  // caricaAccordo).
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const ora = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({
      accordo_approvato_admin_at: ora,
      accordo_approvato_da: profile.id,
      accordo_controfirmato_path: storagePath,
      accordo_controfirmato_sha256: sha256,
      accordo_controfirmato_caricato_at: ora,
    })
    .eq("id", userId);
  if (error) return errore(error.message);

  // Copia di sicurezza su Drive in "Gestione canale/accordi/<polo>/Nome
  // Cognome.pdf" — ora dalla scansione CONTROFIRMATA (entrambe le firme):
  // è quella, non il solo caricamento del Collaboratore, il documento che
  // deve finire nell'archivio. Best-effort: se fallisce, il documento resta
  // comunque nel gestionale con la PEC certificata sotto.
  const nomeSuDrive = `${(target.full_name ?? "accordo").replace(/[/\\:*?"<>|]/g, "_")}.pdf`;
  const { data: membriPoli } = await supabase
    .from("memberships")
    .select("poli!inner(nome)")
    .eq("user_id", userId);
  // "poli!inner(nome)" incorpora un OGGETTO singolo per riga (ogni membership
  // appartiene a un solo polo), non un array: un .flatMap(m.poli.map(...))
  // qui lanciava "m.poli.map is not a function" alla prima esecuzione reale
  // (verificato empiricamente) — mai scattato prima perché non si era mai
  // arrivati fin qui con dati veri.
  const membri = (membriPoli ?? []) as unknown as { poli: { nome: string } }[];
  const poliUtente = membri.map((m) => m.poli.nome);
  await ignora(archiviaAccordoSuDrive(buffer, nomeSuDrive, poliUtente));

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

  // Traccia il caricamento della controfirma nella catena di audit.
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "controfirma_accordo_caricata",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: target.full_name,
        accordo_verificato: target.accordo_verificato,
        caricato_at: ora,
      },
    }),
  );

  // PEC al Collaboratore con il documento controfirmato allegato, copia
  // all'accesso globale — stesso schema di caricaAccordo, mittente e
  // destinatario invertiti. Non parte da qui: entra in coda (0139) e la
  // spedisce il computer, che esce da un indirizzo italiano.
  try {
    await accodaPec({
      oggetto: `[ToothTalk] Accordo editoriale controfirmato — ${nome}`,
      testo: [
        "",
        `Ciao ${nome}!`,
        "",
        "In allegato trovi la scansione dell'Accordo Editoriale controfirmato",
        "dal Titolare: da ora porta entrambe le firme.",
        "",
        "Un ultimo passo prima di partire: accedi al gestionale e conferma, dal",
        "tuo profilo, che è lo stesso documento che hai firmato tu. Solo a",
        "quella conferma verrà generato il Modulo di nomina e si sbloccherà il",
        "tuo accesso ai progetti.",
        "",
        "Impronta SHA-256 del file:",
        `  ${sha256}`,
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk™</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Accordo editoriale controfirmato</h1>
  <p style="font-size:13px;line-height:1.6">
    Ciao <strong>${nome}</strong>! In allegato trovi la scansione dell'Accordo Editoriale
    controfirmato dal Titolare: da ora porta entrambe le firme.
  </p>
  <p style="font-size:13px;line-height:1.6">
    Un ultimo passo prima di partire: accedi al gestionale e conferma, dal tuo
    profilo, che è lo stesso documento che hai firmato tu. Solo a quella conferma
    verrà generato il Modulo di nomina e si sbloccherà il tuo accesso ai progetti.
  </p>
  <p style="font-size:12px;color:#666">Impronta SHA-256: <span style="font-family:monospace">${sha256}</span></p>
  <p style="font-size:11px;color:#999">Messaggio generato automaticamente dal gestionale ToothTalk.</p>
</div>`,
      allegati: [{ nome: nomeFile, bucket: "finali", percorso: storagePath, sha256 }],
      // "to": il collaboratore — PEC se presente, altrimenti la sua email di
      // accesso. "cc": l'accesso globale, come in caricaAccordo al contrario.
      destinatari: [target.pec ?? target.email],
      copiaConoscenza: destinatariPecGlobali(),
    });
  } catch (e) {
    return errore(
      `Controfirma salvata ma PEC non entrata in coda: ${e instanceof Error ? e.message : "errore di accodamento"}`,
    );
  }

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return { ok: true, dati: { approvatoAt: ora } };
}

/**
 * Il Collaboratore conferma che la scansione controfirmata caricata dal
 * Titolare è lo stesso documento che ha firmato: è la QUINTA e ultima
 * condizione che sblocca l'accesso ai progetti (0118, vedi layout.tsx).
 *
 * SOLO a questa conferma — non al caricamento della controfirma — si genera
 * il Modulo di nomina (Documento 4, Art. 6.5 dell'Accordo): è la conferma
 * reciproca (entrambe le firme, entrambe le parti d'accordo che il
 * documento è quello giusto) a perfezionare la nomina.
 */
export async function confermaControfirmaAccordo(): Promise<
  Esito<{ confermatoAt: string; nomina: "ok" | "errore"; nominaErrore?: string }>
> {
  const { profile } = await requireSession();

  if (!profile.accordo_controfirmato_path) {
    return errore("Nessuna controfirma caricata dal Titolare da confermare.");
  }
  if (profile.accordo_controfirma_confermata_at) {
    return errore("Hai già confermato la controfirma.");
  }

  const admin = supabaseAdmin();
  const ora = new Date().toISOString();
  const { error } = await admin
    .from("profiles")
    .update({ accordo_controfirma_confermata_at: ora })
    .eq("id", profile.id);
  if (error) return errore(error.message);

  // Generazione del Documento 4 — SOLO ora: best-effort, un suo fallimento
  // non deve far sembrare fallita la conferma, già avvenuta sopra.
  const esitoNomina = await generaModuloNomina(profile.id, ora);
  if (!esitoNomina.ok) {
    await ignora(
      admin.from("audit_log").insert({
        actor: profile.id,
        actor_role: profile.role,
        action: "generazione_nomina_fallita",
        entity_type: "profile",
        entity_id: profile.id,
        meta: { errore: esitoNomina.errore },
      }),
    );
  }

  await ignora(
    admin.from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "controfirma_accordo_confermata",
      entity_type: "profile",
      entity_id: profile.id,
      meta: { utente: profile.full_name, confermato_at: ora },
    }),
  );

  // Comunicazione all'accesso globale: una PEC in arrivo (non solo una riga in
  // una lista admin) che attesta la conferma. Entra in coda (0139): la
  // spedisce il computer, con i destinatari di default (l'accesso globale).
  // Best-effort: la conferma resta comunque valida e tracciata in audit_log.
  try {
    const nomeConfermato = profile.full_name ?? profile.email;
    const oraIt = dataOra(ora);
    await accodaPec({
      oggetto: `[ToothTalk] Controfirma confermata — ${nomeConfermato}`,
      testo: [
        "",
        `${nomeConfermato} ha confermato, in data ${oraIt}, che la scansione`,
        "dell'Accordo controfirmato caricata è lo stesso documento che ha",
        "firmato. Il Modulo di nomina è stato generato e l'accesso ai progetti",
        "si è sbloccato.",
        "",
        "Messaggio generato automaticamente dal gestionale ToothTalk.",
        "",
      ].join("\n"),
      html: `<div style="max-width:600px;font:14px/1.6 system-ui;color:#0d1b2a">
  <p style="text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#888;margin:0">ToothTalk™</p>
  <h1 style="font-size:20px;margin:4px 0 12px">Controfirma confermata</h1>
  <p style="font-size:13px;line-height:1.6">
    <strong>${nomeConfermato}</strong> ha confermato, in data ${oraIt}, che la scansione
    dell'Accordo controfirmato caricata è lo stesso documento che ha firmato.
    Il Modulo di nomina è stato generato e l'accesso ai progetti si è sbloccato.
  </p>
  <p style="font-size:11px;color:#999">Messaggio generato automaticamente dal gestionale ToothTalk.</p>
</div>`,
      allegati: [],
      // Nessun avviso sul telefono per questa: non c'è niente da fare, è la
      // notizia che la conferma è arrivata (e arriva già nella casella PEC).
      avvisa: false,
    }).catch(() => {});
  } catch {
    // Coda non disponibile (o PEC_DESTINATARI mancante): la conferma resta
    // comunque valida e tracciata in audit_log.
  }

  revalidatePath("/admin");
  revalidatePath("/profilo");
  return {
    ok: true,
    dati: {
      confermatoAt: ora,
      nomina: esitoNomina.ok ? "ok" : "errore",
      nominaErrore: esitoNomina.ok ? undefined : esitoNomina.errore,
    },
  };
}


/**
 * Somma calendariale di mesi a oggi in UTC, con clamp al mese di destinazione
 * (31 gen + 1 mese = 28/29 feb): stessa semantica di `+ interval '6 months'`
 * in Postgres. Restituisce la data come stringa YYYY-MM-DD, coerente con
 * accordo_scadenza (date).
 */
function scadenzaTraMesi(mesi: number, adesso = new Date()): string {
  const giorno = adesso.getUTCDate();
  const anno = adesso.getUTCFullYear();
  const mese = adesso.getUTCMonth() + mesi;
  const ultimoGiorno = new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anno, mese, Math.min(giorno, ultimoGiorno))).toISOString().slice(0, 10);
}

/**
 * Il Titolare approva il documento di rinnovo dell'accordo di un
 * collaboratore (Art. 9.1): riattiva l'accesso spostando accordo_scadenza
 * di 6 mesi avanti da oggi e "consolida" il rinnovo — i campi file si
 * azzerano (rinnovo_path torna null), pronti per il ciclo successivo; la
 * copia su Drive resta come archivio. Solo admin. Tracciato in audit_log.
 *
 * NON rigenera il Modulo di nomina (Documento 4): resta valido, non è
 * legato alla scadenza dei 6 mesi.
 */
export async function approvaRinnovoAccordo(
  userId: string,
): Promise<Esito<{ approvatoAt: string; nuovaScadenza: string }>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const supabase = await supabaseServer();

  // Controllo di coerenza: si approva un rinnovo SOLO su un accordo già
  // approvato, e SOLO se il documento di rinnovo esiste.
  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, accordo_approvato_admin_at, accordo_scadenza, rinnovo_path, rinnovo_caricato_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      accordo_approvato_admin_at: string | null;
      accordo_scadenza: string | null;
      rinnovo_path: string | null;
      rinnovo_caricato_at: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.accordo_approvato_admin_at) {
    return errore("Questo utente non ha ancora un accordo approvato da rinnovare.");
  }
  if (!target.rinnovo_path) return errore("Nessun documento di rinnovo caricato per questo utente.");

  const ora = new Date().toISOString();
  const nuovaScadenza = scadenzaTraMesi(6);

  const { error } = await supabase
    .from("profiles")
    .update({
      rinnovo_approvato_admin_at: ora,
      rinnovo_approvato_da: profile.id,
      accordo_scadenza: nuovaScadenza,
      rinnovo_path: null,
      rinnovo_sha256: null,
      rinnovo_caricato_at: null,
    })
    .eq("id", userId);
  if (error) return errore(error.message);

  // Traccia l'approvazione nella catena di audit.
  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "approvazione_rinnovo_accordo",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: target.full_name,
        rinnovo_caricato_at: target.rinnovo_caricato_at,
        nuova_scadenza: nuovaScadenza,
        approvato_at: ora,
      },
    }),
  );

  revalidatePath("/admin");
  revalidatePath("/profilo");
  revalidatePath("/rinnovo");
  return { ok: true, dati: { approvatoAt: ora, nuovaScadenza } };
}

/**
 * Link firmato e temporaneo al documento di rinnovo caricato da un
 * collaboratore, per la revisione del Coordinatore prima di approvare o
 * rifiutare (Art. 9.1). Il bucket "profili" non è mai accessibile
 * direttamente dal client.
 */
export async function urlDocumentoRinnovo(userId: string): Promise<Esito<string>> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const admin = supabaseAdmin();
  const { data: target } = await admin
    .from("profiles")
    .select("rinnovo_path")
    .eq("id", userId)
    .single<{ rinnovo_path: string | null }>();
  if (!target?.rinnovo_path) return errore("Nessun documento di rinnovo caricato.");

  const { data } = await admin.storage.from("profili").createSignedUrl(target.rinnovo_path, 300);
  if (!data?.signedUrl) return errore("Impossibile generare il link.");
  return { ok: true, dati: data.signedUrl };
}

/**
 * Rifiuta il documento di rinnovo caricato: libera il campo (rinnovo_path
 * torna null) così il Collaboratore può ricaricarne uno nuovo. Non tocca
 * accordo_scadenza: l'accesso resta sospeso esattamente come se il rinnovo
 * non fosse mai stato caricato (Art. 9.1). Il motivo del rifiuto va
 * comunicato fuori dal gestionale — stesso canale informale con cui oggi il
 * documento di rinnovo viene inviato al Collaboratore — ma resta comunque
 * in audit_log per chi deve ricostruire la storia.
 */
export async function rifiutaRinnovoAccordo(
  userId: string,
  motivo: string,
): Promise<Esito<void>> {
  const { isAdmin, profile } = await requireSession();
  if (!isAdmin) return errore("Operazione riservata all'accesso globale.");

  const supabase = await supabaseServer();

  const { data: target } = await supabase
    .from("profiles")
    .select("id, full_name, rinnovo_path, rinnovo_caricato_at")
    .eq("id", userId)
    .single<{
      id: string;
      full_name: string | null;
      rinnovo_path: string | null;
      rinnovo_caricato_at: string | null;
    }>();
  if (!target) return errore("Utente non trovato.");
  if (!target.rinnovo_path) {
    return errore("Nessun documento di rinnovo caricato per questo utente.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      rinnovo_path: null,
      rinnovo_sha256: null,
      rinnovo_caricato_at: null,
    })
    .eq("id", userId);
  if (error) return errore(error.message);

  await ignora(
    supabaseAdmin().from("audit_log").insert({
      actor: profile.id,
      actor_role: profile.role,
      action: "rifiuto_rinnovo_accordo",
      entity_type: "profile",
      entity_id: userId,
      meta: {
        utente: target.full_name,
        motivo,
        rinnovo_caricato_at: target.rinnovo_caricato_at,
        rifiutato_at: new Date().toISOString(),
      },
    }),
  );

  revalidatePath("/admin");
  revalidatePath("/profilo");
  revalidatePath("/rinnovo");
  return { ok: true, dati: undefined };
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

/**
 * Link firmato e temporaneo alla scansione dell'Accordo controfirmato dal
 * Titolare — del chiamante, o di un userId a scelta se admin. Stesso schema
 * di scaricaDocumentoNomina: il download passa sempre dal server, il bucket
 * "finali" non è mai accessibile direttamente dal client.
 */
export async function scaricaControfirmaAccordo(userId?: string): Promise<Esito<string>> {
  const { profile, isAdmin } = await requireSession();
  const target = userId && isAdmin ? userId : profile.id;
  if (userId && userId !== profile.id && !isAdmin) {
    return errore("Puoi scaricare solo la tua controfirma.");
  }

  const admin = supabaseAdmin();
  const { data: c } = await admin
    .from("profiles")
    .select("accordo_controfirmato_path")
    .eq("id", target)
    .single<{ accordo_controfirmato_path: string | null }>();
  if (!c?.accordo_controfirmato_path) return errore("Controfirma non ancora caricata.");

  const { data } = await admin.storage.from("finali").createSignedUrl(c.accordo_controfirmato_path, 300);
  if (!data?.signedUrl) return errore("Impossibile generare il link.");
  return { ok: true, dati: data.signedUrl };
}

/**
 * Download del proprio accordo firmato. Disponibile anche all'uscente a
 * prescindere dalla conferma Art. 9.4: il diritto di accesso ai propri
 * documenti (art. 15 GDPR, promesso nell'informativa) non dipende dagli
 * adempimenti post-uscita. Il file vive nel bucket "profili".
 */
export async function scaricaAccordo(): Promise<Esito<string>> {
  const { profile } = await requireSession();
  const admin = supabaseAdmin();
  const { data: c } = await admin
    .from("profiles")
    .select("accordo_path")
    .eq("id", profile.id)
    .single<{ accordo_path: string | null }>();
  if (!c?.accordo_path) return errore("Accordo non ancora caricato.");

  const { data } = await admin.storage.from("profili").createSignedUrl(c.accordo_path, 300);
  if (!data?.signedUrl) return errore("Impossibile generare il link.");
  return { ok: true, dati: data.signedUrl };
}


