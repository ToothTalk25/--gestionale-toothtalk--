import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import AzioniProgettoRiga from "@/components/AzioniProgettoRiga";
import type { TaskStatus } from "@/lib/types";

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
  const daRevisionare = righe.filter((t) =>
    ["consegnato", "in_revisione"].includes(t.status),
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

      <section className="grid gap-3 sm:grid-cols-3">
        <Card etichetta="Progetti totali" valore={righe.length} />
        <Card etichetta="In attesa di revisione" valore={daRevisionare.length} />
        <Card
          etichetta="Materiali depositati"
          valore={righe.reduce((s, t) => s + Number(t.n_consegne_originali), 0)}
        />
      </section>

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
