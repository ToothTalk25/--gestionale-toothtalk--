import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { KIND_LABEL, type DeliverableVersion, type DeliverableKind } from "@/lib/types";

/**
 * Attestazione di deposito stampabile.
 * È il documento che chi partecipa al gruppo può esibire per dimostrare cosa
 * ha depositato, quando, e che quel file non è stato toccato: il confronto
 * si fa ricalcolando lo SHA-256 del file e confrontandolo con l'impronta qui
 * riportata, la cui posizione nella catena è verificata dal database.
 */
export default async function CertificatoPage({
  params,
}: {
  params: Promise<{ taskId: string; versionId: string }>;
}) {
  const { taskId, versionId } = await params;
  await requireSession();
  const supabase = await supabaseServer();

  const { data: v } = await supabase
    .from("deliverable_versions")
    .select("*")
    .eq("id", versionId)
    .single<DeliverableVersion>();

  if (!v) notFound();

  const [{ data: d }, { data: task }, { data: autore }] = await Promise.all([
    supabase
      .from("deliverables")
      .select("id, kind")
      .eq("id", v.deliverable_id)
      .single<{ id: string; kind: DeliverableKind }>(),
    supabase
      .from("tasks")
      .select("id, titolo, polo_id")
      .eq("id", taskId)
      .single<{ id: string; titolo: string; polo_id: string }>(),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", v.uploaded_by)
      .single<{ full_name: string | null; email: string }>(),
  ]);

  const { data: polo } = await supabase
    .from("poli")
    .select("nome, citta")
    .eq("id", task?.polo_id ?? "")
    .single<{ nome: string; citta: string | null }>();

  const { data: catena } = await supabase.rpc("verifica_catena", {
    p_deliverable: v.deliverable_id,
  });

  const righe = (catena ?? []) as {
    version_no: number;
    origin: string;
    file_name: string;
    uploaded_at: string;
    integra: boolean;
  }[];

  const tuttoIntegro = righe.every((r) => r.integra);

  return (
    <article className="mx-auto max-w-3xl rounded-2xl bg-white p-8 ring-1 ring-black/5">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs uppercase tracking-widest text-slate-400">ToothTalk</p>
        <h1 className="mt-1 text-xl font-semibold">Attestazione di deposito</h1>
        <p className="mt-1 text-sm text-slate-500">
          Documento generato il {new Date().toLocaleString("it-IT")}
        </p>
      </header>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <Voce t="Gruppo universitario" v={`${polo?.nome ?? "—"}${polo?.citta ? ` (${polo.citta})` : ""}`} />
        <Voce t="Progetto" v={task?.titolo ?? "—"} />
        <Voce t="Tipo di materiale" v={d ? KIND_LABEL[d.kind] : "—"} />
        <Voce t="Nome del file" v={v.file_name} />
        <Voce t="Depositato da" v={autore?.full_name ?? autore?.email ?? "—"} />
        <Voce
          t="Data e ora di sigillo"
          v={v.sealed_at ? new Date(v.sealed_at).toLocaleString("it-IT") : "—"}
        />
        <Voce t="Versione" v={`v${v.version_no} · ${v.origin}`} />
        <Voce t="Dimensione" v={v.size_bytes ? `${v.size_bytes} byte` : "—"} />
      </dl>

      <section className="mt-6 space-y-3">
        <Impronta etichetta="Impronta SHA-256 del contenuto" valore={v.sha256} />
        <Impronta etichetta="Hash del record (catena)" valore={v.record_hash} />
        <Impronta
          etichetta="Hash del record precedente"
          valore={v.prev_record_hash ?? "— primo record della catena —"}
        />
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Catena delle versioni</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 pr-3">v</th>
                <th className="py-1 pr-3">Origine</th>
                <th className="py-1 pr-3">File</th>
                <th className="py-1 pr-3">Data</th>
                <th className="py-1">Integrità</th>
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => (
                <tr key={r.version_no} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{r.version_no}</td>
                  <td className="py-1 pr-3">
                    {r.origin === "originale" ? "Deposito del gruppo" : "Versione editata"}
                  </td>
                  <td className="py-1 pr-3">{r.file_name}</td>
                  <td className="py-1 pr-3">
                    {new Date(r.uploaded_at).toLocaleString("it-IT")}
                  </td>
                  <td className={`py-1 ${r.integra ? "text-emerald-700" : "text-red-600"}`}>
                    {r.integra ? "verificata" : "ROTTA"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p
          className={`mt-2 text-xs ${tuttoIntegro ? "text-emerald-700" : "text-red-600"}`}
        >
          {tuttoIntegro
            ? "Catena integra: nessun record è stato alterato dopo la scrittura."
            : "Attenzione: la catena presenta almeno un record non coerente."}
        </p>
      </section>

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <p>
          Come verificare in autonomia: calcola l&apos;impronta del file scaricato con
          <code className="mx-1 rounded bg-slate-100 px-1">shasum -a 256 nomefile</code>
          (macOS/Linux) oppure
          <code className="mx-1 rounded bg-slate-100 px-1">
            certutil -hashfile nomefile SHA256
          </code>
          (Windows). Deve coincidere carattere per carattere con l&apos;impronta
          riportata sopra.
        </p>
      </footer>

      <p className="no-print mt-6 text-xs text-slate-400">
        Cmd/Ctrl + P per stampare o salvare questa attestazione in PDF.
      </p>
    </article>
  );
}

function Voce({ t, v }: { t: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{t}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function Impronta({ etichetta, valore }: { etichetta: string; valore: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{etichetta}</p>
      <p className="font-mono text-xs break-all">{valore}</p>
    </div>
  );
}
