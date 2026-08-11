import Link from "next/link";
import { requireAdmin, ordinaPoli } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { KIND_LABEL, type DeliverableKind, type Polo } from "@/lib/types";
import GestioneInviti, { type RigaInvito } from "@/components/GestioneInviti";
import FotoProfilo from "@/components/FotoProfilo";
import EliminaAccountAdmin from "@/components/EliminaAccountAdmin";

type Confronto = {
  deliverable_id: string;
  task_id: string;
  kind: DeliverableKind;
  originale_file: string | null;
  originale_sigillata_il: string | null;
  finale_file: string | null;
  modificata_da_admin: boolean;
};

type Audit = {
  id: number;
  at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  meta: Record<string, unknown>;
};

export default async function AdminPage() {
  await requireAdmin();
  const supabase = await supabaseServer();

  const [
    { data: audit },
    { data: confronti },
    { data: profili },
    { data: poli },
    { data: inviti },
    { data: membri },
  ] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, at, action, entity_type, entity_id, actor, meta")
      .order("at", { ascending: false })
      .limit(80)
      .returns<Audit[]>(),
    supabase
      .from("v_confronto_versioni")
      .select("*")
      .not("originale_version_id", "is", null)
      .limit(50)
      .returns<Confronto[]>(),
    supabase
      .from("profiles")
      .select(
        "id, full_name, email, role, universita, foto_path, accordo_path, accordo_caricato_at, accordo_verificato",
      )
      .order("role")
      .returns<
        {
          id: string;
          full_name: string | null;
          email: string;
          role: string;
          universita: string | null;
          foto_path: string | null;
          accordo_path: string | null;
          accordo_caricato_at: string | null;
          accordo_verificato: string | null;
        }[]
      >(),
    supabase
      .from("poli")
      .select("id, nome, slug, citta, attivo")
      .eq("attivo", true)
      .order("nome")
      .returns<Polo[]>(),
    supabase
      .from("v_inviti")
      .select("*")
      .order("gruppo")
      .returns<RigaInvito[]>(),
    supabase
      .from("memberships")
      .select("user_id, poli!inner(nome)")
      .returns<{ user_id: string; poli: { nome: string } }[]>(),
  ]);

  const nomi = Object.fromEntries(
    (profili ?? []).map((p) => [p.id, p.full_name ?? p.email]),
  );

  const poliDi: Record<string, string[]> = {};
  for (const m of membri ?? []) {
    (poliDi[m.user_id] ??= []).push(m.poli.nome);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Registro globale</h1>
        <p className="mt-1 text-sm text-slate-500">
          Vista trasversale su tutti i gruppi. Il registro è append-only:
          nessuna voce può essere modificata o cancellata, nemmeno da questa
          pagina.
        </p>
      </header>

      <GestioneInviti poli={ordinaPoli(poli ?? [])} inviti={inviti ?? []} />

      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Originale vs versione finale</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Materiale</th>
                <th className="py-2 pr-4">Deposito del gruppo</th>
                <th className="py-2 pr-4">Versione editata</th>
                <th className="py-2">Stato</th>
              </tr>
            </thead>
            <tbody>
              {(confronti ?? []).map((r) => (
                <tr key={r.deliverable_id} className="border-t border-slate-100">
                  <td className="py-2 pr-4">
                    <Link href={`/task/${r.task_id}`} className="hover:underline">
                      {KIND_LABEL[r.kind]}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {r.originale_file}
                    <div className="text-xs text-slate-400">
                      {r.originale_sigillata_il
                        ? new Date(r.originale_sigillata_il).toLocaleString("it-IT")
                        : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    {r.finale_file ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="py-2 text-xs">
                    {r.modificata_da_admin ? (
                      <span className="text-purple-700">editata</span>
                    ) : (
                      <span className="text-slate-500">originale invariato</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Log delle operazioni</h2>
        <ul className="mt-3 space-y-1 text-sm">
          {(audit ?? []).map((a) => (
            <li key={a.id} className="border-b border-slate-50 py-1">
              <span className="text-xs text-slate-400">
                {new Date(a.at).toLocaleString("it-IT")}
              </span>{" "}
              <strong>{a.action}</strong>{" "}
              <span className="text-slate-500">
                {a.entity_type} · {a.actor ? nomi[a.actor] ?? a.actor : "—"}
              </span>
              {typeof a.meta?.file_name === "string" && (
                <span className="text-slate-400"> · {a.meta.file_name as string}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Registro partecipanti per sede</h2>
        <p className="mt-1 text-sm text-slate-500">
          Anagrafica e accordo editoriale dei partecipanti, raggruppati per
          gruppo.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Gruppo</th>
                <th className="py-2 pr-4">Partecipante</th>
                <th className="py-2 pr-4">Università</th>
                <th className="py-2 pr-4">Foto</th>
                <th className="py-2 pr-4">Accordo editoriale</th>
                <th className="py-2">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {(profili ?? [])
                .filter((p) => p.role !== "admin")
                .map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 text-xs text-slate-500">
                      {poliDi[p.id]?.join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {p.full_name ?? "—"}
                      <div className="text-xs text-slate-400">{p.email}</div>
                    </td>
                    <td className="py-2 pr-4">{p.universita ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {p.foto_path ? (
                        <FotoProfilo path={p.foto_path} className="h-12 w-12 rounded-lg object-cover" />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {p.accordo_path ? (
                        <span className="text-xs">
                          <span className="text-emerald-700">Caricato</span>
                          {p.accordo_caricato_at
                            ? ` · ${new Date(p.accordo_caricato_at).toLocaleDateString("it-IT")}`
                            : ""}
                          {p.accordo_verificato === "ok" && (
                            <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                              IA ok
                            </span>
                          )}
                          {p.accordo_verificato === "attenzione" && (
                            <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                              IA: attenzione
                            </span>
                          )}
                          {p.accordo_verificato === "errato" && (
                            <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
                              IA: errato
                            </span>
                          )}
                          {p.accordo_verificato === "non_valutato" && (
                            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                              IA: non valutato
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Non caricato</span>
                      )}
                    </td>
                    <td className="py-2">
                      <EliminaAccountAdmin userId={p.id} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Creazione utenti e assegnazione ai poli:{" "}
          <code className="rounded bg-slate-100 px-1">npm run utente</code>
        </p>
      </section>
    </div>
  );
}
