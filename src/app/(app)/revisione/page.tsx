import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import RichiesteModifica from "@/components/RichiesteModifica";
import {
  PACCHETTO_LABEL,
  type RichiestaModifica,
  type VideoDaRivedere,
} from "@/lib/types";

/**
 * Coda di revisione dei video sigillati.
 *
 * Il pacchetto è già immutabile e già certificato via PEC: qui non si
 * modifica nulla, si annotano le correzioni da fare. Restano dentro la
 * piattaforma, visibili a chi partecipa al gruppo, invece di disperdersi
 * nelle conversazioni.
 */
export default async function RevisionePage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const { data: video } = await supabase
    .from("v_video_da_rivedere")
    .select("*")
    .order("sigillato_at", { ascending: false })
    .returns<VideoDaRivedere[]>();

  const lista = video ?? [];

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

  const { data: profili } = autori.size
    ? await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", [...autori])
        .returns<{ id: string; full_name: string | null; email: string }[]>()
    : { data: [] as { id: string; full_name: string | null; email: string }[] };

  const nomi = Object.fromEntries(
    (profili ?? []).map((p) => [p.id, p.full_name ?? p.email]),
  );

  const daFare = lista.filter((v) => v.richieste_aperte > 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Video da rivedere</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          I video completati e sigillati, pronti per la revisione editoriale.
          Il pacchetto è già stato certificato via PEC e non è modificabile:
          qui si annotano le correzioni, che restano visibili al gruppo dentro
          la piattaforma.
        </p>
      </header>

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
