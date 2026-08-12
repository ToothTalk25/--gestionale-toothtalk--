import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import NumeroVideoEditor from "@/components/NumeroVideoEditor";
import { supabaseServer } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import StatusControls from "@/components/StatusControls";
import TaskTextEditor from "@/components/TaskTextEditor";
import UploadDeliverable from "@/components/UploadDeliverable";
import VersionList from "@/components/VersionList";
import PacchettoVideo, { type ElementoCaricato } from "@/components/PacchettoVideo";
import RichiesteModifica from "@/components/RichiesteModifica";
import AzioniProgetto from "@/components/AzioniProgetto";
import GoogleDocCard from "@/components/GoogleDocCard";
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

  const { data: task } = await supabase
    .from("tasks")
    .select(
      "*, formati(id, slug, nome, richiede_liberatoria, script_richiesto, istruzioni_script)",
    )
    .eq("id", taskId)
    .single<Task & { formati: Formato | null }>();

  if (!task) notFound();

  const { data: polo } = await supabase
    .from("poli")
    .select("nome, drive_immagini_montaggio_folder_id")
    .eq("id", task.polo_id)
    .single<{ nome: string; drive_immagini_montaggio_folder_id: string | null }>();

  const { data: deliverables } = await supabase
    .from("deliverables")
    .select("*")
    .eq("task_id", taskId)
    .returns<Deliverable[]>();

  const ids = (deliverables ?? []).map((d) => d.id);

  const { data: versioni } = ids.length
    ? await supabase
        .from("deliverable_versions")
        .select("*")
        .in("deliverable_id", ids)
        .order("version_no", { ascending: true })
        .returns<DeliverableVersion[]>()
    : { data: [] as DeliverableVersion[] };

  const { data: richieste } = await supabase
    .from("richieste_modifica")
    .select("*")
    .eq("task_id", taskId)
    .order("creata_at", { ascending: false })
    .returns<RichiestaModifica[]>();

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

  // Pacchetto pubblicabile: separato dai materiali di lavorazione.
  const { data: pacchetto } = await supabase
    .from("pacchetti_video")
    .select("*")
    .eq("task_id", taskId)
    .neq("stato", "annullato")
    .maybeSingle<PacchettoVideoRow>();

  type ElementoRaw = {
    ruolo: "video" | "copertina" | "liberatoria";
    deliverable_versions: {
      file_name: string;
      sha256: string;
      size_bytes: number | null;
      uploaded_at: string;
    };
  };

  const { data: elementiRaw } = pacchetto
    ? await supabase
        .from("pacchetto_elementi")
        .select("ruolo, deliverable_versions!inner(file_name, sha256, size_bytes, uploaded_at)")
        .eq("pacchetto_id", pacchetto.id)
        .returns<ElementoRaw[]>()
    : { data: [] as ElementoRaw[] };

  const elementiPacchetto: ElementoCaricato[] = (elementiRaw ?? []).map((e) => ({
    ruolo: e.ruolo,
    ...e.deliverable_versions,
  }));

  // Stato della copia su Google Drive (RLS: accesso globale o membri del gruppo).
  const { data: esportazione } = pacchetto
    ? await supabase
        .from("esportazioni_drive")
        .select("*")
        .eq("pacchetto_id", pacchetto.id)
        .maybeSingle<EsportazioneDriveRow>()
    : { data: null };

  // Ultimo esito riconoscimento automatico (Fase D)
  const { data: verificaRiconoscimento } = pacchetto
    ? await supabase
        .from("verifiche_riconoscimento")
        .select("esito, dettaglio")
        .eq("pacchetto_id", pacchetto.id)
        .order("creato_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ esito: string; dettaglio: string | null }>()
    : { data: null };

  const { data: storico } = await supabase
    .from("task_status_history")
    .select("id, da_status, a_status, at, actor")
    .eq("task_id", taskId)
    .order("at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-8">
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
          <StatusBadge status={task.status} />
          <NumeroVideoEditor
            taskId={task.id}
            numeroVideo={task.numero_video ?? null}
            isAdmin={isAdmin}
          />
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

        <div className="grid grid-cols-3 lg:grid-cols-4 gap-3">
          {KIND_LAVORAZIONE.map((kind) => {
            const d = (deliverables ?? []).find((x) => x.kind === kind);
            const vs = (versioni ?? []).filter((v) => v.deliverable_id === d?.id);
            const accetta = kind === "immagini_montaggio" ? "image/*" : undefined;
            const mancaNumeroVideo =
              kind === "immagini_montaggio" &&
              !!polo?.drive_immagini_montaggio_folder_id &&
              task.numero_video == null;

            const isGoogleDoc = kind === "script" || kind === "descrizione";

            return (
              <div key={kind} className="group aspect-square rounded-xl bg-white p-3 ring-1 ring-black/5 flex flex-col">
                <h3 className="text-base font-semibold text-slate-700 text-center">{KIND_LABEL[kind]}</h3>

                <div className="flex-1 flex items-center justify-center">
                  {isGoogleDoc ? (
                    <GoogleDocCard
                      taskId={task.id}
                      kind={kind}
                      googleDocUrl={d?.google_doc_url ?? null}
                      isAdmin={isAdmin}
                    />
                  ) : mancaNumeroVideo ? (
                    <p className="text-xs text-amber-700 text-center px-2">
                      Prima assegna un numero video.
                    </p>
                  ) : vs.length > 0 ? (
                    <div className="text-center">
                      <div className="text-4xl mb-1 font-bold">{vs.length}</div>
                      <p className="text-[10px] text-slate-400">
                        {vs.length === 1 ? "file caricato" : "file caricati"}
                      </p>
                      <div className="flex justify-center">
                        <UploadDeliverable
                          taskId={task.id}
                          kind={kind}
                          isAdmin={isAdmin}
                          locked={task.locked}
                          esisteOriginale={vs.some((v) => v.origin === "originale")}
                          accept={accetta}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="mb-2 text-4xl text-slate-300 font-light">+</div>
                      <div className="flex justify-center">
                        <UploadDeliverable
                          taskId={task.id}
                          kind={kind}
                          isAdmin={isAdmin}
                          locked={task.locked}
                          esisteOriginale={false}
                          accept={accetta}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {vs.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto border-t border-slate-100 pt-2">
                    <VersionList
                      taskId={task.id}
                      versioni={vs}
                      nomi={nomi}
                      deliverableId={d?.id}
                    />
                  </div>
                )}
              </div>
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
        verificaRiconoscimento={verificaRiconoscimento}
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
