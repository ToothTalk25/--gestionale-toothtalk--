import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import NewTaskForm from "@/components/NewTaskForm";
import type { Formato, Polo, TaskStatus } from "@/lib/types";

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

  // Formati attivi per la scelta in fase di creazione progetto.
  const { data: formati } = await supabase
    .from("formati")
    .select("*")
    .eq("attivo", true)
    .order("nome")
    .returns<Formato[]>();

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
      .select("user_id")
      .eq("polo_id", poloId)
      .returns<{ user_id: string }[]>(),
  ]);

  // Solo i nomi, via funzione dedicata: il profilo completo resta personale.
  const idsMembri = (membri ?? []).map((m) => m.user_id);
  let nomiMembri: { id: string; full_name: string | null; email: string }[] = [];
  if (idsMembri.length) {
    const res = await supabase.rpc("nomi_visibili", { p_ids: idsMembri });
    nomiMembri = (res.data ?? []) as { id: string; full_name: string | null; email: string }[];
  }
  const nomeDi = Object.fromEntries(
    nomiMembri.map((p) => [p.id, p.full_name ?? p.email]),
  );

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
            {(membri ?? [])
              .map((m) => nomeDi[m.user_id] ?? "—")
              .join(" · ")}
          </p>
        )}
      </header>

      <NewTaskForm poloId={polo.id} formati={formati ?? []} />

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
