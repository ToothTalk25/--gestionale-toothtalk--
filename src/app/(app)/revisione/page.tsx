import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import RichiesteModifica from "@/components/RichiesteModifica";
import BottoneArchiviaTutto from "@/components/BottoneArchiviaTutto";
import {
  PACCHETTO_LABEL,
  type PacchettoDaArchiviare,
  type PacchettoPronto,
  type RichiestaModifica,
  type VideoDaRivedere,
} from "@/lib/types";

/**
 * Coda di revisione: pacchetti segnalati completi da rivedere prima del
 * sigillo, e pacchetti già sigillati.
 *
 * Le correzioni si aprono solo prima di sigillare (rimandano il pacchetto in
 * composizione). Su un video già sigillato non se ne aprono più: qui restano
 * solo eventuali richieste aperte da prima di questa regola, o il pulsante
 * "Annulla pacchetto" per farne comporre uno nuovo da capo.
 */
export default async function RevisionePage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const { data: video } = await supabase
    .from("v_video_da_rivedere")
    .select("*")
    .order("sigillato_at", { ascending: false })
    .returns<VideoDaRivedere[]>();

  // Pacchetti segnalati dal gruppo come completati, prima del sigillo: è qui
  // che chi ha accesso globale decide se sigillare o rimandare in composizione.
  const { data: pronti } = await supabase
    .from("v_pacchetti_pronti")
    .select("*")
    .order("pronto_at", { ascending: false })
    .returns<PacchettoPronto[]>();

  const lista = video ?? [];
  const inAttesa = pronti ?? [];

  const { data: richieste } = lista.length
    ? await supabase
        .from("richieste_modifica")
        .select("*")
        .in(
          "task_id",
          lista.map((v) => v.task_id),
        )
        .order("creata_at", { ascending: false })
        .returns<RichiestaModifica[]>()
    : { data: [] as RichiestaModifica[] };

  const autori = new Set(
    (richieste ?? []).flatMap((r) =>
      [r.creata_da, r.risolta_da].filter((x): x is string => !!x),
    ),
  );

  let profili: { id: string; full_name: string | null; email: string }[] = [];
  if (autori.size) {
    const res = await supabase.rpc("nomi_visibili", { p_ids: [...autori] });
    profili = (res.data ?? []) as { id: string; full_name: string | null; email: string }[];
  }

  const nomi = Object.fromEntries(
    (profili ?? []).map((p) => [p.id, p.full_name ?? p.email]),
  );

  const daFare = lista.filter((v) => v.richieste_aperte > 0);

  // Pacchetti sigillati con file ancora su Storage (da archiviare)
  const { data: daArchiviare } = await supabase
    .from("v_pacchetti_da_archiviare")
    .select("*")
    .order("sigillato_at", { ascending: true })
    .returns<PacchettoDaArchiviare[]>();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Video da rivedere</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Quando il gruppo segnala un pacchetto come completato, lo rivedi qui:
          decidi se sigillarlo o, se manca qualcosa, apri una richiesta di
          modifica — il pacchetto torna in composizione da solo. I video già
          sigillati restano sotto, in sola consultazione.
        </p>
      </header>

      {inAttesa.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">In attesa della tua revisione</h2>
            <p className="text-sm text-slate-500">
              I gruppi hanno segnalato questi pacchetti come completati: apri
              la scheda, rivedi il materiale e decidi se sigillare o rimandare
              in composizione.
            </p>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden tt-card-piccola">
            {inAttesa.map((v) => (
              <li key={v.pacchetto_id}>
                <Link
                  href={`/task/${v.task_id}`}
                  className="flex flex-wrap items-center gap-3.5 px-5 py-4 hover:bg-slate-50"
                >
                  <span className="w-[76px] shrink-0 text-[11.5px] font-semibold uppercase text-slate-400">
                    {v.gruppo}
                  </span>
                  <span className="flex-1 text-sm font-medium">{v.progetto}</span>
                  <span className="text-xs text-slate-400">
                    {v.pronto_at
                      ? `segnalato il ${new Date(v.pronto_at).toLocaleString("it-IT")}`
                      : ""}
                  </span>
                  <span className="rounded-full bg-violet-100 px-[11px] py-[3px] text-xs font-semibold text-violet-800">
                    {PACCHETTO_LABEL[v.stato]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <Card etichetta="Video sigillati" valore={lista.length} icona="sigillo" />
        <Card
          etichetta="Con modifiche aperte"
          valore={daFare.length}
          icona="modifiche"
          allerta={daFare.length > 0}
        />
        <Card
          etichetta="Certificati via PEC"
          valore={lista.filter((v) => v.pec_inviata_at).length}
          icona="pec"
        />
      </section>

      {lista.length === 0 ? (
        <p className="tt-card-piccola p-6 text-sm text-slate-500">
          Nessun video sigillato, per ora.
        </p>
      ) : (
        <div className="space-y-4">
          {lista.map((v) => (
            <article
              key={v.pacchetto_id}
              className="tt-card p-6"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {v.gruppo}
                  </p>
                  <h2 className="mt-0.5 text-[17px] font-semibold tracking-[-0.015em]">
                    <Link href={`/task/${v.task_id}`} className="hover:underline">
                      {v.progetto}
                    </Link>
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Sigillato il{" "}
                    {v.sigillato_at
                      ? new Date(v.sigillato_at).toLocaleString("it-IT")
                      : "—"}
                    {v.pec_inviata_at
                      ? ` · PEC inviata il ${new Date(v.pec_inviata_at).toLocaleString("it-IT")}`
                      : " · PEC non ancora inviata"}
                    {v.coinvolge_terzi ? " · con liberatoria" : ""}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {v.richieste_aperte > 0 && (
                    <span className="rounded-full bg-[#fef3e2] px-[11px] py-[3px] text-xs font-semibold text-amber-700">
                      {v.richieste_aperte} da correggere
                    </span>
                  )}
                  <span className="rounded-full bg-slate-100 px-[11px] py-[3px] text-xs font-semibold text-slate-600">
                    {PACCHETTO_LABEL[v.stato]}
                  </span>
                  <Link
                    href={`/task/${v.task_id}/verbale/${v.pacchetto_id}`}
                    className="tt-btn border border-slate-300 px-3 py-1.5 text-xs"
                  >
                    Verbale
                  </Link>
                </div>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-4">
                <RichiesteModifica
                  taskId={v.task_id}
                  pacchettoId={v.pacchetto_id}
                  pacchettoStato={v.stato}
                  richieste={(richieste ?? []).filter(
                    (r) => r.task_id === v.task_id,
                  )}
                  nomi={nomi}
                  isAdmin
                  compatta
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {(daArchiviare ?? []).length > 0 && (
        <section className="tt-card p-6">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Da archiviare</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pacchetti già sigillati e certificati via PEC: puoi liberare spazio
            su Supabase una volta che sono al sicuro su Drive e hard disk esterno.
          </p>
          <div className="mt-4 divide-y divide-slate-100">
            {(daArchiviare ?? []).map((p) => (
              <div key={p.pacchetto_id} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    <Link href={`/task/${p.task_id}`} className="hover:underline">
                      {p.progetto}
                    </Link>
                  </p>
                  <p className="text-xs text-slate-400">
                    {p.gruppo} · sigillato il {p.sigillato_at ? new Date(p.sigillato_at).toLocaleDateString("it-IT") : "—"} · {p.file_da_archiviare} file
                  </p>
                </div>
                <BottoneArchiviaTutto taskId={p.task_id} pacchettoId={p.pacchetto_id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Stesso riquadro di sintesi con icona tinta usato in dashboard: qui erano
 *  rimasti piatti, la stessa card visivamente diversa in due pagine. */
function Card({
  etichetta,
  valore,
  icona,
  allerta = false,
}: {
  etichetta: string;
  valore: number;
  icona: "sigillo" | "modifiche" | "pec";
  allerta?: boolean;
}) {
  return (
    <div className="tt-card-piccola p-4">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            allerta ? "bg-amber-50 text-amber-700" : "bg-tt-blue-50 text-tt-blue-600"
          }`}
        >
          {icona === "sigillo" && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 12l2 2 4-4" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          )}
          {icona === "modifiche" && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          )}
          {icona === "pec" && (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          )}
        </span>
        <span className="text-xs font-medium text-slate-500">{etichetta}</span>
      </div>
      <div className={`mt-2.5 text-2xl font-bold tracking-tight ${allerta ? "text-amber-700" : ""}`}>
        {valore}
      </div>
    </div>
  );
}
