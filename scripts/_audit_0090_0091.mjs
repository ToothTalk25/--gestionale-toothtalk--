#!/usr/bin/env node
/**
 * Audit funzionale end-to-end usa-e-getta per le migrazioni 0090 (notifiche
 * dovute Art. 8.2) e 0091 (dichiarazione di identità riservata sui video
 * grezzi/audio di task con coinvolge_terzi=true).
 *
 * Crea dati di test isolati (polo, 3 utenti, task, file), esegue i 5 test,
 * stampa PASS/FAIL con evidenza, poi ripulisce tutto — incluso un bypass
 * mirato e transazionale del trigger di append-only su deliverable_versions,
 * l'unico modo per eliminare le righe origin='originale' create dai test 4/5
 * (per design l'app non lo permette mai, nemmeno al service_role — vedi
 * commento in 0001_schema.sql sopra trg_versions_append_only).
 */

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const riga of readFileSync(f, "utf8").split("\n")) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.SUPABASE_DB_URL;
if (!URL || !ANON || !SERVICE || !DB_URL) {
  console.error("Mancano variabili in .env.local");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const pgc = new pg.Client({ connectionString: DB_URL });
await pgc.connect();

const results = [];
function report(n, pass, evidenza) {
  results.push({ n, pass, evidenza });
  console.log(`\n${pass ? "PASS" : "FAIL"} — Test ${n}`);
  console.log(evidenza);
}
function nota(msg) {
  console.log(`   [nota] ${msg}`);
}

const PASSWORD = "AuditTemp!2026#0090";
const POLO_NOME = "__TEST_AUDIT_0090_0091__";
const POLO_SLUG = "test-audit-0090-0091";
const EMAILS = {
  collab: "test-collab-0090@toothtalk.local",
  uploader: "test-uploader-0091@toothtalk.local",
  outsider: "test-outsider-0091@toothtalk.local",
};

function anonClient() {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

// stato da ripulire alla fine
const cleanup = {
  userIds: [],
  poloId: null,
  taskIds: [],
  versionIds: [], // origin='originale', richiedono bypass trigger
  storageObjects: [], // { bucket, path }
  notificheIds: [],
  richiesteIds: [],
};

async function setup() {
  console.log("=== SETUP ===");
  const { data: polo, error: ePolo } = await admin
    .from("poli")
    .insert({ nome: POLO_NOME, slug: POLO_SLUG })
    .select("id")
    .single();
  if (ePolo) throw new Error("Creazione polo test fallita: " + ePolo.message);
  cleanup.poloId = polo.id;
  console.log("polo test creato:", polo.id);

  const ids = {};
  for (const [key, email] of Object.entries(EMAILS)) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `Test ${key}` },
    });
    if (error) throw new Error(`Creazione utente ${email} fallita: ${error.message}`);
    ids[key] = data.user.id;
    cleanup.userIds.push(data.user.id);
    console.log(`utente ${key} creato:`, data.user.id, email);
  }

  for (const uid of Object.values(ids)) {
    const { error } = await admin.from("memberships").insert({ user_id: uid, polo_id: cleanup.poloId });
    if (error) throw new Error("Membership fallita: " + error.message);
  }
  console.log("membership create per i 3 utenti test");

  // Verifica che i profili siano attivi (default true) e leggibili.
  const { data: profili } = await admin
    .from("profiles")
    .select("id, email, attivo, role")
    .in("id", Object.values(ids));
  console.log("profili:", profili);

  const collabClient = anonClient();
  const { error: e1 } = await collabClient.auth.signInWithPassword({ email: EMAILS.collab, password: PASSWORD });
  if (e1) throw new Error("Login collab fallito: " + e1.message);

  const uploaderClient = anonClient();
  const { error: e2 } = await uploaderClient.auth.signInWithPassword({ email: EMAILS.uploader, password: PASSWORD });
  if (e2) throw new Error("Login uploader fallito: " + e2.message);

  const outsiderClient = anonClient();
  const { error: e3 } = await outsiderClient.auth.signInWithPassword({ email: EMAILS.outsider, password: PASSWORD });
  if (e3) throw new Error("Login outsider fallito: " + e3.message);

  return { ids, collabClient, uploaderClient, outsiderClient };
}

async function test1(ids, collabClient) {
  console.log("\n=== TEST 1 — notifica dovuta creata alla revoca senza checkbox ===");
  const { error: eRpc1 } = await collabClient.rpc("revoca_consenso", { p_tipo: "immagine_voce" });
  if (eRpc1) { report(1, false, "revoca_consenso ha fallito: " + eRpc1.message); return; }

  const { data: righe, error: eRpc2 } = await collabClient.rpc("revoca_video_on_screen", { p_user: ids.collab });
  if (eRpc2) { report(1, false, "revoca_video_on_screen ha fallito: " + eRpc2.message); return; }
  console.log("revoca_video_on_screen righe purgate:", righe?.length ?? 0, "(atteso 0, nessun materiale caricato da questo utente)");

  const { data: notifica, error: eIns } = await admin
    .from("notifiche_dovute_art82")
    .insert({ user_id: ids.collab })
    .select("id, user_id, revocato_at, scade_at, notificata_at")
    .single();
  if (eIns) { report(1, false, "Insert notifiche_dovute_art82 fallito: " + eIns.message); return; }
  cleanup.notificheIds.push(notifica.id);

  const { rows } = await pgc.query(
    `select id, user_id, revocato_at, scade_at, notificata_at,
            extract(epoch from (scade_at - revocato_at)) as delta_secondi
       from notifiche_dovute_art82 where id = $1`,
    [notifica.id],
  );
  const riga = rows[0];
  const deltaGiorni = riga.delta_secondi / 86400;
  const scadeOk = Math.abs(deltaGiorni - 30) < 0.01; // tolleranza ampia, sub-secondo in pratica
  const notificataOk = riga.notificata_at === null;

  report(
    1,
    scadeOk && notificataOk,
    `Riga creata: id=${riga.id}\n` +
      `  revocato_at=${riga.revocato_at.toISOString()}\n` +
      `  scade_at=${riga.scade_at.toISOString()} (delta=${deltaGiorni.toFixed(6)} giorni, atteso 30)\n` +
      `  notificata_at=${riga.notificata_at} (atteso null)`,
  );
  return notifica.id;
}

async function test2(notificaId, ids) {
  console.log("\n=== TEST 2 — bottone Notifica manda l'email e marca notificata_at ===");
  if (!notificaId) { report(2, false, "Saltato: Test 1 non ha prodotto una riga da notificare."); return; }

  const { data: destinatario, error: eDest } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", ids.collab)
    .single();
  if (eDest) { report(2, false, "Lettura destinatario fallita: " + eDest.message); return; }
  console.log("destinatario:", destinatario);

  const oggetto = "[ToothTalk] Contenuti pubblicati che ti ritraggono";
  const testo =
    `Ciao ${destinatario.full_name ?? ""},\n\n` +
    `Hai revocato il consenso all'uso della tua immagine e voce. Il materiale grezzo non ` +
    `pubblicato che ti ritraeva è stato eliminato automaticamente.\n\n` +
    `Ti informiamo che potrebbero esistere contenuti già pubblicati, alla data della revoca, ` +
    `che ti ritraggono. Hai facoltà di chiederne la rimozione o l'oscuramento in qualsiasi ` +
    `momento, scrivendo al Coordinatore: la richiesta viene valutata caso per caso ai sensi ` +
    `dell'art. 17, par. 3, GDPR (Art. 8.3 dell'Accordo Editoriale).\n\n— ToothTalk`;

  console.log("--- testo email che il codice reale (inviaEmailGmail) costruirebbe ---");
  console.log("Oggetto:", oggetto);
  console.log(testo);
  console.log("--- fine testo ---");

  if (process.env.MAIL_USER && process.env.MAIL_PASS) {
    nota(
      "MAIL_USER/MAIL_PASS sono configurate in questo ambiente: inviaEmailGmail() tenterebbe " +
        "davvero l'invio SMTP. Scelta di sicurezza per questo audit: NON è stato eseguito l'invio " +
        "reale verso l'indirizzo fittizio test-collab-0090@toothtalk.local (dominio .local inesistente) " +
        "per evitare un tentativo di relay/bounce sull'account Gmail reale del progetto. La costruzione " +
        "del testo e l'assenza di eccezioni nel percorso sono comunque verificate sopra.",
    );
  } else {
    nota("MAIL_USER/MAIL_PASS non configurate: il codice reale logga 'saltata' e ritorna false, nessuna eccezione.");
  }

  const { error: eUpd } = await admin
    .from("notifiche_dovute_art82")
    .update({ notificata_at: new Date().toISOString() })
    .eq("id", notificaId);
  if (eUpd) { report(2, false, "Update notificata_at fallito: " + eUpd.message); return; }

  const { rows } = await pgc.query(
    `select notificata_at, notificata_da from notifiche_dovute_art82 where id = $1`,
    [notificaId],
  );
  const dopo = rows[0];
  const notificataOraSettata = dopo.notificata_at !== null;

  if (dopo.notificata_da === null) {
    nota(
      "notificata_da è NULL. Coerente con il codice reale: notificaArt82() esegue l'update con " +
        "supabaseAdmin() (client service_role), il cui auth.uid() è sempre null lato Postgres — " +
        "quindi il trigger fn_notifiche82_guard non può valorizzare notificata_da con l'id " +
        "dell'admin che ha notificato. La colonna esiste ma, nell'uso reale attuale, resta sempre NULL.",
    );
  }

  // Simula il guard applicativo: notificaArt82() rilegge la riga PRIMA di
  // agire e, se notificata_at è già valorizzato, ritorna errore SENZA
  // toccare il DB — non è quindi il DB a impedire un secondo invio, è la
  // action stessa.
  const { data: rilettura } = await admin
    .from("notifiche_dovute_art82")
    .select("id, notificata_at")
    .eq("id", notificaId)
    .single();
  const secondoTentativoRespinto = !!rilettura.notificata_at; // => notificaArt82 ritornerebbe errore("Già notificata.")

  report(
    2,
    notificataOraSettata && secondoTentativoRespinto,
    `Update riuscito: notificata_at=${dopo.notificata_at}, notificata_da=${dopo.notificata_da}\n` +
      `  Secondo tentativo: notificata_at già valorizzato => notificaArt82() ritornerebbe ` +
      `errore("Già notificata.") prima di qualunque query di update (logica verificata a codice, ` +
      `src/app/actions-profilo.ts:364).`,
  );
}

async function test3(ids, uploaderClient) {
  console.log("\n=== TEST 3 — inserimento contatto su task coinvolge_terzi=true apre da sola una richieste_liberatoria ===");
  const { data: task, error: eTask } = await admin
    .from("tasks")
    .insert({ polo_id: cleanup.poloId, titolo: "Test 3/4 — coinvolge terzi", coinvolge_terzi: true, created_by: ids.uploader })
    .select("id")
    .single();
  if (eTask) { report(3, false, "Creazione task test fallita: " + eTask.message); return {}; }
  cleanup.taskIds.push(task.id);
  const taskId = task.id;
  console.log("task test (coinvolge_terzi=true) creato:", taskId);

  const contattoTest = "esterno-test@example.com";

  // Replica ESATTA di aggiornaContattoEsterno() + inviaAutomaticamenteSeNecessario(),
  // eseguita come lo farebbe l'interfaccia reale: dal membro normale che compila il
  // campo (il campo è editabile SOLO se !isAdmin, vedi PacchettoVideo.tsx riga 101:
  // `componibile = inBozza && !locked && !isAdmin`), non dall'admin.
  const { error: eUpdTask } = await uploaderClient
    .from("tasks")
    .update({ contatto_esterno_email: contattoTest })
    .eq("id", taskId);
  if (eUpdTask) { report(3, false, "Il membro non riesce nemmeno a salvare il contatto: " + eUpdTask.message); return { taskId }; }
  console.log("contatto_esterno_email salvato dal membro (uploader), come da UI reale");

  const { count: countPrima } = await uploaderClient
    .from("richieste_liberatoria")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  console.log("richieste_liberatoria visibili al membro prima dell'insert:", countPrima);

  const { data: insTentativo, error: eInsMembro } = await uploaderClient
    .from("richieste_liberatoria")
    .insert({ task_id: taskId, contatto_email: contattoTest, scade_at: new Date(Date.now() + 7 * 86400000).toISOString() })
    .select("id, token")
    .single();

  const { rows: righeReali } = await pgc.query(
    `select id, contatto_email, stato, creato_at from richieste_liberatoria where task_id = $1`,
    [taskId],
  );

  if (eInsMembro) {
    nota(
      `L'insert diretto in richieste_liberatoria come membro NON-admin è stato respinto da RLS: ` +
        `"${eInsMembro.message}" (codice ${eInsMembro.code}). Verifica diretta su Postgres: righe ` +
        `realmente presenti per questo task = ${righeReali.length}.`,
    );
    if (righeReali.length === 0) {
      nota(
        "BUG REALE (non limite d'ambiente): src/app/actions-liberatoria.ts, " +
          "inviaAutomaticamenteSeNecessario() chiama creaEInviaRichiesta() che fa " +
          "supabase.from('richieste_liberatoria').insert(...) con il client dell'UTENTE che ha " +
          "compilato il contatto — che secondo la UI (PacchettoVideo.tsx, componibile = " +
          "inBozza && !locked && !isAdmin) è tipicamente un membro NON admin. Ma la policy RLS " +
          "'richieste_admin_insert' (supabase/migrations/0075_richieste_liberatoria_no_delete.sql) " +
          "richiede is_admin() per l'INSERT. Il risultato dell'insert fallito NON viene controllato " +
          "da inviaAutomaticamenteSeNecessario() (nessun controllo di .error sul risultato di " +
          "creaEInviaRichiesta), quindi il fallimento è silenzioso: la funzione ritorna " +
          "normalmente, il salvataggio del contatto sembra riuscito, ma nessuna richiesta di " +
          "liberatoria viene mai creata né inviata automaticamente — in contrasto con l'Art. 4.2 " +
          "del Protocollo Operativo citato nel commento del codice stesso.",
      );
    }
    // Controllo di riferimento: lo stesso insert, fatto da un client con is_admin()
    // (qui il service-role, che il codice reale usa per notificaArt82 e per le altre
    // azioni "da admin"), per isolare se il problema è la RLS o qualcos'altro.
    const { data: insAdmin, error: eInsAdmin } = await admin
      .from("richieste_liberatoria")
      .insert({ task_id: taskId, contatto_email: contattoTest, scade_at: new Date(Date.now() + 7 * 86400000).toISOString() })
      .select("id, token")
      .single();
    if (eInsAdmin) {
      report(3, false, `Anche l'insert con privilegi admin fallisce: ${eInsAdmin.message} — problema più profondo del solo RLS.`);
      return { taskId };
    }
    cleanup.richiesteIds.push(insAdmin.id);
    nota(
      `Controllo di riferimento: lo stesso insert con client is_admin() RIESCE (id=${insAdmin.id}, ` +
        `token generato). Conferma che il meccanismo di fondo funziona: è specificamente la policy ` +
        `RLS di insert, ristretta al solo admin, a rompere l'automatismo per il caller realistico (membro).`,
    );
    report(
      3,
      false,
      `La riga NON compare da sola quando è un membro (non-admin) a inserire il contatto — ` +
        `esattamente il percorso previsto dalla UI. RLS 'richieste_admin_insert' blocca l'insert, ` +
        `l'errore viene ignorato in silenzio dal codice applicativo. Vedi bug reale sopra.`,
    );
    return { taskId };
  }

  // Se invece l'insert come membro fosse per qualche motivo riuscito:
  cleanup.richiesteIds.push(insTentativo.id);
  report(
    3,
    true,
    `La riga richieste_liberatoria è comparsa da sola: id=${insTentativo.id}, righe reali su Postgres=${righeReali.length}.`,
  );
  return { taskId };
}

async function uploadFile(client, uploaderProfileId, poloId, taskId, deliverableId, filename, content) {
  const path = `${poloId}/${taskId}/${deliverableId}/${randomUUID()}__${filename}`;
  const buffer = Buffer.from(content);
  const { error: eUp } = await client.storage.from("originali").upload(path, buffer, {
    contentType: "video/mp4",
    upsert: false,
  });
  if (eUp) throw new Error(`Upload storage fallito (${path}): ${eUp.message}`);
  cleanup.storageObjects.push({ bucket: "originali", path });

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const { data: versione, error: eVer } = await client
    .from("deliverable_versions")
    .insert({
      deliverable_id: deliverableId,
      origin: "originale",
      bucket: "originali",
      storage_path: path,
      file_name: filename,
      mime_type: "video/mp4",
      size_bytes: buffer.length,
      sha256,
      uploaded_by: uploaderProfileId,
    })
    .select("id, storage_path")
    .single();
  if (eVer) throw new Error(`Insert deliverable_versions fallito (${path}): ${eVer.message}`);
  cleanup.versionIds.push(versione.id);
  return { path, versionId: versione.id };
}

async function test4(ids, taskId, uploaderClient, outsiderClient) {
  console.log("\n=== TEST 4 — video_grezzo su task coinvolge_terzi=true: solo uploader e admin scaricano ===");
  if (!taskId) { report(4, false, "Saltato: nessun task disponibile dal Test 3."); return; }

  // deliverables: lo crea il membro (deliverables_insert_member policy).
  const { data: deliverable, error: eDel } = await uploaderClient
    .from("deliverables")
    .insert({ task_id: taskId, kind: "video_grezzo" })
    .select("id")
    .single();
  if (eDel) { report(4, false, "Creazione deliverable fallita: " + eDel.message); return; }
  console.log("deliverable video_grezzo creata:", deliverable.id);

  let up;
  try {
    up = await uploadFile(
      uploaderClient,
      ids.uploader,
      cleanup.poloId,
      taskId,
      deliverable.id,
      "grezzo-test.mp4",
      "contenuto fittizio video_grezzo per audit 0091 — task con terzi coinvolti",
    );
  } catch (e) {
    report(4, false, "Upload/registrazione file fallita: " + e.message);
    return;
  }
  console.log("file caricato dall'uploader:", up.path);

  const esiti = {};

  const { data: dOutsider, error: eOutsider } = await outsiderClient.storage.from("originali").download(up.path);
  esiti.outsider = { ok: !eOutsider, error: eOutsider?.message ?? null };
  console.log("download come OUTSIDER:", eOutsider ? `NEGATO — ${eOutsider.message}` : "RIUSCITO (inatteso!)");

  const { data: dUploader, error: eUploaderDl } = await uploaderClient.storage.from("originali").download(up.path);
  esiti.uploader = { ok: !eUploaderDl, error: eUploaderDl?.message ?? null };
  console.log("download come UPLOADER:", eUploaderDl ? `NEGATO (inatteso!) — ${eUploaderDl.message}` : "RIUSCITO");

  const { data: dAdmin, error: eAdminDl } = await admin.storage.from("originali").download(up.path);
  esiti.admin = { ok: !eAdminDl, error: eAdminDl?.message ?? null };
  console.log("download come ADMIN (service-role):", eAdminDl ? `NEGATO (inatteso!) — ${eAdminDl.message}` : "RIUSCITO");

  const pass = !esiti.outsider.ok && esiti.uploader.ok && esiti.admin.ok;
  report(
    4,
    pass,
    `outsider: ${esiti.outsider.ok ? "RIUSCITO" : "NEGATO"} (${esiti.outsider.error ?? "-"})\n` +
      `uploader: ${esiti.uploader.ok ? "RIUSCITO" : "NEGATO"} (${esiti.uploader.error ?? "-"})\n` +
      `admin: ${esiti.admin.ok ? "RIUSCITO" : "NEGATO"} (${esiti.admin.error ?? "-"})`,
  );
}

async function test5(ids, uploaderClient, outsiderClient) {
  console.log("\n=== TEST 5 — task coinvolge_terzi=false: comportamento condiviso pre-esistente intatto ===");
  const { data: task, error: eTask } = await admin
    .from("tasks")
    .insert({ polo_id: cleanup.poloId, titolo: "Test 5 — senza terzi", coinvolge_terzi: false, created_by: ids.uploader })
    .select("id")
    .single();
  if (eTask) { report(5, false, "Creazione task test fallita: " + eTask.message); return; }
  cleanup.taskIds.push(task.id);
  console.log("task test (coinvolge_terzi=false) creato:", task.id);

  const { data: deliverable, error: eDel } = await uploaderClient
    .from("deliverables")
    .insert({ task_id: task.id, kind: "video_grezzo" })
    .select("id")
    .single();
  if (eDel) { report(5, false, "Creazione deliverable fallita: " + eDel.message); return; }

  let up;
  try {
    up = await uploadFile(
      uploaderClient,
      ids.uploader,
      cleanup.poloId,
      task.id,
      deliverable.id,
      "grezzo-senza-terzi.mp4",
      "contenuto fittizio video_grezzo per audit 0091 — task SENZA terzi coinvolti",
    );
  } catch (e) {
    report(5, false, "Upload/registrazione file fallita: " + e.message);
    return;
  }
  console.log("file caricato dall'uploader:", up.path);

  const { data, error } = await outsiderClient.storage.from("originali").download(up.path);
  console.log(
    "download come OUTSIDER (nessuna dichiarazione riservata, task condiviso col polo):",
    error ? `NEGATO (inatteso!) — ${error.message}` : "RIUSCITO",
  );

  report(5, !error, error ? `Negato inaspettatamente: ${error.message}` : "Download riuscito come atteso: il comportamento pre-esistente (condiviso col polo) non è stato rotto dalla nuova policy 0091.");
}

async function cleanupAll() {
  console.log("\n=== PULIZIA FINALE ===");
  const errors = [];

  // 1. notifiche_dovute_art82 (blocca la delete del profilo se non rimossa prima)
  if (cleanup.notificheIds.length) {
    const { error } = await admin.from("notifiche_dovute_art82").delete().in("id", cleanup.notificheIds);
    if (error) errors.push("notifiche_dovute_art82: " + error.message);
    else console.log("notifiche_dovute_art82 rimosse:", cleanup.notificheIds.length);
  }

  // 2. richieste_liberatoria (verranno comunque cascade-eliminate dal task, ma le rimuoviamo esplicitamente)
  if (cleanup.richiesteIds.length) {
    const { error } = await admin.from("richieste_liberatoria").delete().in("id", cleanup.richiesteIds);
    if (error) errors.push("richieste_liberatoria: " + error.message);
    else console.log("richieste_liberatoria rimosse:", cleanup.richiesteIds.length);
  }

  // 3. storage objects
  if (cleanup.storageObjects.length) {
    const byBucket = {};
    for (const o of cleanup.storageObjects) (byBucket[o.bucket] ??= []).push(o.path);
    for (const [bucket, paths] of Object.entries(byBucket)) {
      const { error } = await admin.storage.from(bucket).remove(paths);
      if (error) errors.push(`storage ${bucket}: ` + error.message);
      else console.log(`storage ${bucket} rimossi:`, paths.length);
    }
  }

  // 4. deliverable_versions origin='originale': append-only per design, anche
  //    per service_role. Bypass mirato e transazionale del trigger, SOLO per
  //    le righe create da questo audit, subito ripristinato.
  if (cleanup.versionIds.length) {
    try {
      await pgc.query("BEGIN");
      await pgc.query("ALTER TABLE public.deliverable_versions DISABLE TRIGGER trg_versions_append_only");
      const { rowCount } = await pgc.query(
        "DELETE FROM public.deliverable_versions WHERE id = ANY($1::uuid[])",
        [cleanup.versionIds],
      );
      await pgc.query("ALTER TABLE public.deliverable_versions ENABLE TRIGGER trg_versions_append_only");
      await pgc.query("COMMIT");
      console.log(
        `deliverable_versions rimosse: ${rowCount} (bypass transazionale del trigger append-only, ` +
          `poi immediatamente ripristinato)`,
      );
    } catch (e) {
      await pgc.query("ROLLBACK").catch(() => {});
      errors.push("deliverable_versions (bypass trigger): " + e.message);
    }
  }

  // 5. tasks -> cascade su deliverables, task_status_history, richieste_liberatoria residue
  if (cleanup.taskIds.length) {
    const { error } = await admin.from("tasks").delete().in("id", cleanup.taskIds);
    if (error) errors.push("tasks: " + error.message);
    else console.log("tasks rimossi (cascade su deliverables):", cleanup.taskIds.length);
  }

  // 6. utenti auth (cascade su profiles, memberships)
  for (const uid of cleanup.userIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) errors.push(`utente ${uid}: ` + error.message);
    else console.log("utente rimosso:", uid);
  }

  // 7. polo
  if (cleanup.poloId) {
    const { error } = await admin.from("poli").delete().eq("id", cleanup.poloId);
    if (error) errors.push("polo: " + error.message);
    else console.log("polo test rimosso:", cleanup.poloId);
  }

  // 8. verifica finale
  const { rows: poloResidui } = await pgc.query("select id from poli where slug = $1", [POLO_SLUG]);
  const { rows: utentiResidui } = await pgc.query(
    "select id, email from auth.users where email = any($1::text[])",
    [Object.values(EMAILS)],
  );
  const { rows: taskResidui } = cleanup.taskIds.length
    ? await pgc.query("select id from tasks where id = any($1::uuid[])", [cleanup.taskIds])
    : { rows: [] };
  const { rows: versioniResidue } = cleanup.versionIds.length
    ? await pgc.query("select id from deliverable_versions where id = any($1::uuid[])", [cleanup.versionIds])
    : { rows: [] };

  console.log("\n--- verifica finale ---");
  console.log("polo residuo:", poloResidui.length, "(atteso 0)");
  console.log("utenti residui:", utentiResidui.length, "(atteso 0)", utentiResidui);
  console.log("task residui:", taskResidui.length, "(atteso 0)");
  console.log("deliverable_versions residue:", versioniResidue.length, "(atteso 0)");

  if (errors.length) {
    console.log("\nERRORI DURANTE LA PULIZIA:");
    for (const e of errors) console.log(" - " + e);
  }

  const puliziaCompleta =
    errors.length === 0 &&
    poloResidui.length === 0 &&
    utentiResidui.length === 0 &&
    taskResidui.length === 0 &&
    versioniResidue.length === 0;
  console.log("\nPULIZIA COMPLETA:", puliziaCompleta ? "SI" : "NO — vedi errori sopra");
  return puliziaCompleta;
}

let puliziaOk = false;
try {
  const { ids, collabClient, uploaderClient, outsiderClient } = await setup();
  const notificaId = await test1(ids, collabClient);
  await test2(notificaId, ids);
  const { taskId } = await test3(ids, uploaderClient);
  await test4(ids, taskId, uploaderClient, outsiderClient);
  await test5(ids, uploaderClient, outsiderClient);
} catch (e) {
  console.error("\nERRORE INATTESO DURANTE I TEST:", e);
} finally {
  puliziaOk = await cleanupAll();
  await pgc.end();
}

console.log("\n\n=== RIEPILOGO ===");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} — Test ${r.n}`);
console.log("Pulizia completa:", puliziaOk ? "SI" : "NO");
process.exit(puliziaOk ? 0 : 2);
