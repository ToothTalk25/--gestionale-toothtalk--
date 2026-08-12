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
        <h1 className="text-2xl font-semibold">Video da rivedere</h1>
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
            <h2 className="text-lg font-medium">In attesa della tua revisione</h2>
            <p className="text-sm text-slate-500">
              I gruppi hanno segnalato questi pacchetti come completati: apri
              la scheda, rivedi il materiale e decidi se sigillare o rimandare
              in composizione.
            </p>
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
            {inAttesa.map((v) => (
              <li key={v.pacchetto_id}>
                <Link
                  href={`/task/${v.task_id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="w-24 shrink-0 text-xs font-medium text-slate-400">
                    {v.gruppo}
                  </span>
                  <span className="flex-1 text-sm font-medium">{v.progetto}</span>
                  <span className="text-xs text-slate-400">
                    {v.pronto_at
                      ? `segnalato il ${new Date(v.pronto_at).toLocaleString("it-IT")}`
                      : ""}
                  </span>
                  <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800">
                    {PACCHETTO_LABEL[v.stato]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <Card etichetta="Video sigillati" valore={lista.length} />
        <Card etichetta="Con modifiche aperte" valore={daFare.length} />
        <Card
          etichetta="Certificati via PEC"
          valore={lista.filter((v) => v.pec_inviata_at).length}
        />
      </section>

      {lista.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-black/5">
          Nessun video sigillato, per ora.
        </p>
      ) : (
        <div className="space-y-4">
          {lista.map((v) => (
            <article
              key={v.pacchetto_id}
              className="rounded-2xl bg-white p-6 ring-1 ring-black/5"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {v.gruppo}
                  </p>
                  <h2 className="mt-0.5 text-lg font-medium">
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
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      {v.richieste_aperte} da correggere
                    </span>
                  )}
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    {PACCHETTO_LABEL[v.stato]}
                  </span>
                  <Link
                    href={`/task/${v.task_id}/verbale/${v.pacchetto_id}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
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
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-lg font-medium">Da archiviare</h2>
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

function Card({ etichetta, valore }: { etichetta: string; valore: number }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <div className="text-2xl font-semibold">{valore}</div>
      <div className="text-xs text-slate-500">{etichetta}</div>
    </div>
  );
}
