import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import NumeroVideoEditor from "@/components/NumeroVideoEditor";
import { supabaseServer } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import StatusControls from "@/components/StatusControls";
import TaskTextEditor from "@/components/TaskTextEditor";
import KindCard from "@/components/KindCard";
import SegnalaPolo from "@/components/SegnalaPolo";
import PacchettoVideo, { type ElementoCaricato } from "@/components/PacchettoVideo";
import RichiesteModifica from "@/components/RichiesteModifica";
import AzioniProgetto from "@/components/AzioniProgetto";
import {
  KIND_LABEL,
  KIND_LAVORAZIONE,
  type Deliverable,
  type DeliverableVersion,
  type EsportazioneDriveRow,
  type Formato,
  type PacchettoVideoRow,
  type RichiestaModifica,
  type Task,
} from "@/lib/types";

export default async function TaskPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const { profile, isAdmin } = await requireSession();
  const supabase = await supabaseServer();

  type ElementoRaw = {
    ruolo: "video" | "copertina" | "liberatoria";
    deliverable_versions: {
      version_id: string;
      file_name: string;
      sha256: string;
      size_bytes: number | null;
      uploaded_at: string;
      archiviato_esterno: boolean;
    };
  };
  type EsitoRiconoscimento = { esito: string; dettaglio: string | null };

  // Tutte le query di questa pagina dipendono solo da taskId (nessuna
  // aspetta il risultato di un'altra) tranne polo/versioni/profili/i dati
  // legati al pacchetto: lanciarle in sequenza con await, una alla volta,
  // significava un giro di rete Supabase dopo l'altro — su una connessione
  // debole si sentiva parecchio nel cambio pagina. Raggruppate per onda:
  // ogni onda parte in parallelo, la successiva usa solo dati già arrivati.
  const [
    { data: task },
    { data: deliverables },
    { data: richieste },
    { data: pacchetto },
    { data: storico },
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "*, formati(id, slug, nome, richiede_liberatoria, script_richiesto, istruzioni_script)",
      )
      .eq("id", taskId)
      .single<Task & { formati: Formato | null }>(),
    supabase.from("deliverables").select("*").eq("task_id", taskId).returns<Deliverable[]>(),
    supabase
      .from("richieste_modifica")
      .select("*")
      .eq("task_id", taskId)
      .order("creata_at", { ascending: false })
      .returns<RichiestaModifica[]>(),
    // Pacchetto pubblicabile: separato dai materiali di lavorazione.
    supabase
      .from("pacchetti_video")
      .select("*")
      .eq("task_id", taskId)
      .neq("stato", "annullato")
      .maybeSingle<PacchettoVideoRow>(),
    supabase
      .from("task_status_history")
      .select("id, da_status, a_status, at, actor")
      .eq("task_id", taskId)
      .order("at", { ascending: false })
      .limit(20),
  ]);

  if (!task) notFound();

  const ids = (deliverables ?? []).map((d) => d.id);

  const [{ data: polo }, { data: versioni }, { data: elementiRaw }, { data: esportazione }, { data: verificaVideo }, { data: verificaCopertina }, { data: liberatoriaInfo }] =
    await Promise.all([
      supabase
        .from("poli")
        .select("nome, drive_immagini_montaggio_folder_id")
        .eq("id", task.polo_id)
        .single<{ nome: string; drive_immagini_montaggio_folder_id: string | null }>(),
      ids.length
        ? supabase
            .from("deliverable_versions")
            .select("*")
            .in("deliverable_id", ids)
            .order("version_no", { ascending: true })
            .returns<DeliverableVersion[]>()
        : Promise.resolve({ data: [] as DeliverableVersion[] }),
      pacchetto
        ? supabase
            .from("pacchetto_elementi")
            .select("ruolo, deliverable_versions!inner(version_id:id, file_name, sha256, size_bytes, uploaded_at, archiviato_esterno)")
            .eq("pacchetto_id", pacchetto.id)
            .returns<ElementoRaw[]>()
        : Promise.resolve({ data: [] as ElementoRaw[] }),
      // Stato della copia su Google Drive (RLS: accesso globale o membri del gruppo).
      pacchetto
        ? supabase.from("esportazioni_drive").select("*").eq("pacchetto_id", pacchetto.id).maybeSingle<EsportazioneDriveRow>()
        : Promise.resolve({ data: null }),
      // Ultimo esito riconoscimento automatico (Fase D), video e copertina
      // sono verificati separatamente: un vecchio esito negativo dell'uno non
      // deve nascondersi dietro l'ultimo esito pulito dell'altro.
      pacchetto
        ? supabase
            .from("verifiche_riconoscimento")
            .select("esito, dettaglio")
            .eq("pacchetto_id", pacchetto.id)
            .eq("ruolo", "video")
            .order("creato_at", { ascending: false })
            .limit(1)
            .maybeSingle<EsitoRiconoscimento>()
        : Promise.resolve({ data: null }),
      pacchetto
        ? supabase
            .from("verifiche_riconoscimento")
            .select("esito, dettaglio")
            .eq("pacchetto_id", pacchetto.id)
            .eq("ruolo", "copertina")
            .order("creato_at", { ascending: false })
            .limit(1)
            .maybeSingle<EsitoRiconoscimento>()
        : Promise.resolve({ data: null }),
      // Esiste una richiesta di liberatoria firmata via OTP per questo progetto?
      // Stessa condizione esatta controllata da sigilla_pacchetto (0052): non la
      // più recente in assoluto, perché ogni invio crea una nuova riga e una
      // vecchia già firmata resterebbe valida anche se ne esiste una più nuova
      // ancora in sospeso — prendere solo "l'ultima" farebbe dire alla UI che il
      // sigillo è bloccato quando il server lo permetterebbe comunque.
      supabase
        .from("richieste_liberatoria")
        .select("stato, metodo_firma")
        .eq("task_id", taskId)
        .eq("stato", "caricata")
        .eq("metodo_firma", "otp")
        .limit(1)
        .maybeSingle<{ stato: string; metodo_firma: string | null }>(),
    ]);

  const elementiPacchetto: ElementoCaricato[] = (elementiRaw ?? []).map((e) => ({
    ruolo: e.ruolo,
    ...e.deliverable_versions,
  }));

  // Una sola query per tutti i nomi che compaiono nella pagina: chi ha
  // caricato file e chi ha aperto o chiuso una richiesta.
  const autori = new Set([
    ...(versioni ?? []).map((v) => v.uploaded_by),
    ...(richieste ?? []).flatMap((r) =>
      [r.creata_da, r.risolta_da].filter((x): x is string => !!x),
    ),
  ]);

  let profili: { id: string; full_name: string | null; email: string }[] = [];
  if (autori.size) {
    const res = await supabase.rpc("nomi_visibili", { p_ids: [...autori] });
    profili = (res.data ?? []) as { id: string; full_name: string | null; email: string }[];
  }

  const nomi = Object.fromEntries(
    (profili ?? []).map((p) => [p.id, p.full_name ?? p.email]),
  );

  return (
    <div className="space-y-8">
      <SegnalaPolo poloId={task.polo_id} />
      <header className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              <Link href={`/polo/${task.polo_id}`} className="hover:underline">
                {polo?.nome}
              </Link>
            </p>
            <AzioniProgetto
              taskId={task.id}
              titolo={task.titolo}
              poloId={task.polo_id}
              status={task.status}
            />
            <p className="mt-1 text-xs text-slate-400">
              {task.scadenza
                ? `Scadenza ${new Date(task.scadenza).toLocaleDateString("it-IT")} · `
                : ""}
              aggiornata il{" "}
              {new Date(task.updated_at).toLocaleString("it-IT")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            <StatusBadge status={task.status} />
            <NumeroVideoEditor
              taskId={task.id}
              numeroVideo={task.numero_video ?? null}
              isAdmin={isAdmin}
            />
          </div>
        </div>

        {task.locked && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Progetto bloccato: i contenuti non sono più modificabili dal gruppo.
            I materiali già depositati restano visibili e scaricabili.
          </p>
        )}

        <div className="mt-5">
          <StatusControls
            taskId={task.id}
            status={task.status}
            locked={task.locked}
            isAdmin={isAdmin}
          />
        </div>
      </header>

      {/* Le correzioni richieste sono la prima cosa da vedere aprendo un
          progetto: è il canale che sostituisce i messaggi sparsi. */}
      {((richieste ?? []).length > 0 || isAdmin) && (
        <RichiesteModifica
          taskId={task.id}
          pacchettoId={pacchetto?.id ?? null}
          pacchettoStato={pacchetto?.stato ?? null}
          richieste={richieste ?? []}
          nomi={nomi}
          isAdmin={isAdmin}
        />
      )}

      {(isAdmin || task.note_admin) && (
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          {isAdmin ? (
            <>
              <h3 className="text-sm font-medium text-slate-600">
                Note di revisione{" "}
                <span className="font-normal text-slate-400">
                  (visibili al gruppo, scrivibili solo da qui)
                </span>
              </h3>
              <TaskTextEditor
                taskId={task.id}
                campo="note_admin"
                valore={task.note_admin}
                disabilitato={false}
                placeholder="Indicazioni di revisione…"
              />
            </>
          ) : (
            <>
              <h3 className="text-sm font-medium text-slate-600">Note di revisione</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                {task.note_admin}
              </p>
            </>
          )}
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Materiali di lavorazione</h2>
          <p className="text-sm text-slate-500">
            Lo spazio di lavoro condiviso: girato grezzo, bozze, materiali di
            servizio. Trascina o clicca su ogni card per caricare.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {KIND_LAVORAZIONE.map((kind) => {
            const d = (deliverables ?? []).find((x) => x.kind === kind);
            const vs = (versioni ?? []).filter((v) => v.deliverable_id === d?.id);
            const accetta = kind === "immagini_montaggio" ? "image/*" : undefined;
            const mancaNumeroVideo =
              kind === "immagini_montaggio" &&
              !!polo?.drive_immagini_montaggio_folder_id &&
              task.numero_video == null;

            const isGoogleDoc = kind === "script" || kind === "descrizione" || kind === "titolo_youtube";

            return (
              <KindCard
                key={kind}
                taskId={task.id}
                kind={kind}
                label={KIND_LABEL[kind]}
                isAdmin={isAdmin}
                locked={task.locked}
                isGoogleDoc={isGoogleDoc}
                googleDocUrl={d?.google_doc_url ?? null}
                mancaNumeroVideo={mancaNumeroVideo}
                versioni={vs}
                deliverableId={d?.id}
                accetta={accetta}
                nomi={nomi}
              />
            );
          })}
        </div>
      </section>

      <PacchettoVideo
        taskId={task.id}
        pacchetto={pacchetto ?? null}
        elementi={elementiPacchetto}
        isAdmin={isAdmin}
        locked={task.locked}
        coinvolgeTerzi={task.coinvolge_terzi}
        esportazione={esportazione ?? null}
        formato={task.formati ?? null}
        contattoEsternoEmail={task.contatto_esterno_email ?? null}
        contattoEsternoPec={task.contatto_esterno_pec ?? null}
        verificaRiconoscimento={{ video: verificaVideo ?? null, copertina: verificaCopertina ?? null }}
        googleDocUrls={{
          script: (deliverables ?? []).find(d => d.kind === "script")?.google_doc_url ?? null,
          descrizione: (deliverables ?? []).find(d => d.kind === "descrizione")?.google_doc_url ?? null,
          titoloYoutube: (deliverables ?? []).find(d => d.kind === "titolo_youtube")?.google_doc_url ?? null,
        }}
        liberatoriaInfo={liberatoriaInfo ?? null}
        haRichiesteAperte={(richieste ?? []).some((r) => r.stato === "aperta" || r.stato === "da_verificare")}
      />

      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Storico stati</h2>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {(storico ?? []).map((s) => (
            <li key={s.id}>
              <span className="text-slate-400">
                {new Date(s.at).toLocaleString("it-IT")}
              </span>{" "}
              — {s.da_status ? `${s.da_status} → ` : "creata come "}
              <strong>{s.a_status}</strong>
              {s.actor ? ` · ${nomi[s.actor] ?? ""}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-slate-400">
        Utente corrente: {profile.email} · ruolo {profile.role}
      </p>
    </div>
  );
}
