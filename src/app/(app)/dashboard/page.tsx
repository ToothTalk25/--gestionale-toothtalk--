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

  // Panoramica per polo: la RLS della vista restringe già ai poli visibili
  // (tutti per l'admin, il proprio per un membro) — nessun filtro qui.
  const { data: panoramicaPoli } = await supabase
    .from("v_polo_overview")
    .select("*")
    .order("polo_nome")
    .returns<PoloOverview[]>();

  const inAttesaRevisione = (panoramicaPoli ?? []).reduce(
    (s, p) => s + Number(p.in_attesa_revisione),
    0,
  );

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

      <section className="grid gap-3 sm:grid-cols-2">
        <Card etichetta="Progetti totali" valore={righe.length} />
        <Card etichetta="In attesa di revisione" valore={inAttesaRevisione} />
      </section>

      {isAdmin && panoramicaPoli && panoramicaPoli.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Panoramica team</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {panoramicaPoli.map((p) => (
              <Link
                key={p.polo_id}
                href={`/polo/${p.polo_id}`}
                className="rounded-xl bg-white p-4 ring-1 ring-black/5 hover:ring-2 hover:ring-tt-blue/30 transition-shadow"
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
          <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-black/5">
            Nessun progetto. Apri un polo per crearne uno.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
            {righe.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/task/${t.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50"
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

function Card({ etichetta, valore }: { etichetta: string; valore: number }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-black/5">
      <div className="text-2xl font-semibold">{valore}</div>
      <div className="text-xs text-slate-500">{etichetta}</div>
    </div>
  );
}
