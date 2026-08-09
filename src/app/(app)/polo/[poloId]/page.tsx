import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import NewTaskForm from "@/components/NewTaskForm";
import type { Polo, TaskStatus } from "@/lib/types";

export default async function PoloPage({
  params,
}: {
  params: Promise<{ poloId: string }>;
}) {
  const { poloId } = await params;
  await requireSession();
  const supabase = await supabaseServer();

  const { data: polo } = await supabase
    .from("poli")
    .select("id, nome, slug, citta, attivo")
    .eq("id", poloId)
    .single<Polo>();

  if (!polo) notFound();

  const [{ data: tasks }, { data: membri }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, titolo, status, scadenza, locked, updated_at")
      .eq("polo_id", poloId)
      .order("updated_at", { ascending: false })
      .returns<
        {
          id: string;
          titolo: string;
          status: TaskStatus;
          scadenza: string | null;
          locked: boolean;
          updated_at: string;
        }[]
      >(),
    supabase
      .from("memberships")
      .select("user_id, profiles!inner(full_name, email)")
      .eq("polo_id", poloId)
      .returns<{ user_id: string; profiles: { full_name: string | null; email: string } }[]>(),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">{polo.nome}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {polo.citta ? `${polo.citta} · ` : ""}
          {membri?.length ?? 0} partecipanti, tutti con gli stessi permessi.
        </p>
        {!!membri?.length && (
          <p className="mt-2 text-xs text-slate-400">
            {membri.map((m) => m.profiles.full_name ?? m.profiles.email).join(" · ")}
          </p>
        )}
      </header>

      <NewTaskForm poloId={polo.id} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Progetti del gruppo</h2>
        {!tasks?.length ? (
          <p className="rounded-xl bg-white p-6 text-sm text-slate-500 ring-1 ring-black/5">
            Ancora nessun progetto.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white ring-1 ring-black/5">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/task/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="flex-1 text-sm font-medium">{t.titolo}</span>
                  {t.scadenza && (
                    <span className="text-xs text-slate-400">
                      scad. {new Date(t.scadenza).toLocaleDateString("it-IT")}
                    </span>
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
