import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import AzioniProgettoRiga from "@/components/AzioniProgettoRiga";
import type { PoloOverview, TaskStatus } from "@/lib/types";

type Riga = {
  id: string;
  polo_id: string;
  polo_nome: string;
  titolo: string;
  status: TaskStatus;
  scadenza: string | null;
  locked: boolean;
  updated_at: string;
  n_consegne_originali: number;
  n_versioni_admin: number;
};

export default async function DashboardPage() {
  const { profile, poli, isAdmin } = await requireSession();
  const supabase = await supabaseServer();

  // Nessun filtro esplicito sul polo: la RLS restituisce già solo ciò che
  // questo utente può vedere. L'Admin riceve tutto, il membro il suo polo.
  const { data: tasks } = await supabase
    .from("v_task_overview")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<Riga[]>();

  const righe = tasks ?? [];

  // Panoramica per polo: riservata all'admin.
  const { data: panoramicaPoli } = isAdmin
    ? await supabase.from("v_polo_overview").select("*").order("polo_nome").returns<PoloOverview[]>()
    : { data: null };

  const inAttesaRevisione = isAdmin
    ? (panoramicaPoli ?? []).reduce((s, p) => s + Number(p.in_attesa_revisione), 0)
    : (
        await supabase
          .from("pacchetti_video")
          .select("id", { count: "exact", head: true })
          .eq("stato", "pronto")
      ).count ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">
          Ciao {profile.full_name?.split(" ")[0] ?? ""}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isAdmin
            ? `Vista globale su ${poli.length} poli.`
            : `${poli.map((p) => p.nome).join(", ") || "Nessun gruppo"} — tutti i partecipanti del gruppo hanno i tuoi stessi permessi.`}
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card etichetta="Progetti totali" valore={righe.length} icona="progetti" />
        <Card
          etichetta="In attesa di revisione"
          valore={inAttesaRevisione}
          icona="attesa"
          allerta={inAttesaRevisione > 0}
        />
      </section>

      {isAdmin && panoramicaPoli && panoramicaPoli.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Panoramica team</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {panoramicaPoli.map((p) => (
              <Link
                key={p.polo_id}
                href={`/polo/${p.polo_id}`}
                className="tt-card-piccola p-4 transition-shadow hover:shadow-[0_1px_2px_rgba(23,40,55,.04),0_10px_24px_-10px_rgba(23,40,55,.18)]"
              >
                <h3 className="font-semibold text-slate-800">{p.polo_nome}</h3>
                <p className="text-xs text-slate-400">{p.progetti_totali} progetti</p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-500">In lavorazione</span>
                  <span className="text-right font-medium text-slate-700">{p.in_lavorazione}</span>
                  <span className={`${p.in_attesa_revisione > 0 ? "text-amber-700 font-medium" : "text-slate-500"}`}>
                    In attesa revisione
                  </span>
                  <span className={`text-right font-medium ${p.in_attesa_revisione > 0 ? "text-amber-700" : "text-slate-700"}`}>
                    {p.in_attesa_revisione}
                  </span>
                  <span className="text-slate-500">Sigillati</span>
                  <span className="text-right font-medium text-slate-700">{p.sigillati}</span>
                  {p.pec_errore > 0 && (
                    <>
                      <span className="text-red-600 font-medium">Errore PEC</span>
                      <span className="text-right font-medium text-red-600">{p.pec_errore}</span>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Progetti</h2>
          {poli.length > 0 && (
            <Link
              href={`/polo/${poli[0].id}`}
              className="text-sm text-tt-blue hover:underline"
            >
              Nuovo progetto →
            </Link>
          )}
        </div>

        {righe.length === 0 ? (
          <p className="tt-card p-6 text-sm text-slate-500">
            Nessun progetto. Apri un polo per crearne uno.
          </p>
        ) : (
          <ul className="tt-card divide-y divide-slate-100 overflow-hidden">
            {righe.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/task/${t.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="w-24 shrink-0 text-xs font-medium text-slate-400">
                    {t.polo_nome}
                  </span>
                  <span className="flex-1 text-sm font-medium">{t.titolo}</span>
                  {t.locked && (
                    <span className="text-xs text-slate-400">bloccato</span>
                  )}
                  <span className="text-xs text-slate-400">
                    {t.n_consegne_originali} file
                  </span>
                  {t.status === "da_fare" && (
                    <AzioniProgettoRiga
                      taskId={t.id}
                      titolo={t.titolo}
                      poloId={t.polo_id}
                    />
                  )}
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Riquadro di sintesi. L'icona in un quadrato tinto dà al numero un ancoraggio
 * visivo: senza, due riquadri identici si distinguono solo leggendo l'etichetta.
 * "allerta" vira il numero all'ambra quando c'è qualcosa che aspetta davvero
 * una tua azione — lo zero resta neutro, così il colore significa qualcosa.
 */
function Card({
  etichetta,
  valore,
  icona,
  allerta = false,
}: {
  etichetta: string;
  valore: number;
  icona: "progetti" | "attesa";
  allerta?: boolean;
}) {
  return (
    <div className="tt-card p-5">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            allerta ? "bg-amber-50 text-amber-700" : "bg-tt-blue-50 text-tt-blue-600"
          }`}
        >
          {icona === "progetti" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
          )}
        </span>
        <span className="text-sm font-medium text-slate-500">{etichetta}</span>
      </div>
      <div
        className={`mt-3 text-3xl font-bold tracking-tight ${
          allerta ? "text-amber-700" : ""
        }`}
      >
        {valore}
      </div>
    </div>
  );
}
