import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import {
  PACCHETTO_LABEL,
  type ManifestoPacchetto,
  type PacchettoVideoRow,
} from "@/lib/types";

const ETICHETTA: Record<string, string> = {
  video: "Video montato",
  copertina: "Copertina",
  descrizione: "Descrizione da pubblicare",
  script: "Script usato per il video",
};

/**
 * Verbale di deposito del pacchetto pubblicabile, stampabile in PDF.
 * È la copia locale di ciò che è stato spedito via PEC.
 */
export default async function VerbalePage({
  params,
}: {
  params: Promise<{ taskId: string; pacchettoId: string }>;
}) {
  const { pacchettoId } = await params;
  await requireSession();
  const supabase = await supabaseServer();

  const { data: p } = await supabase
    .from("pacchetti_video")
    .select("*")
    .eq("id", pacchettoId)
    .single<PacchettoVideoRow>();

  if (!p || !p.manifest) notFound();

  const m: ManifestoPacchetto = p.manifest;

  const { data: verifica } = await supabase.rpc("verifica_manifesto", {
    p_pacchetto: pacchettoId,
  });
  const integro = Array.isArray(verifica) ? verifica[0]?.integro !== false : true;

  return (
    <article className="mx-auto max-w-3xl rounded-2xl bg-white p-8 ring-1 ring-black/5">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-xs uppercase tracking-widest text-slate-400">ToothTalk</p>
        <h1 className="mt-1 text-xl font-semibold">
          Verbale di deposito — pacchetto video pubblicabile
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Stato: {PACCHETTO_LABEL[p.stato]}
        </p>
      </header>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <Voce t="Polo" v={`${m.polo.nome}${m.polo.citta ? ` (${m.polo.citta})` : ""}`} />
        <Voce t="Progetto" v={m.task.titolo} />
        <Voce t="Sigillato il" v={m.sigillato_at} />
        <Voce
          t="Sigillato da"
          v={`${m.sigillato_da.nome ?? ""} <${m.sigillato_da.email}>`}
        />
        <Voce
          t="PEC inviata il"
          v={p.pec_inviata_at ? new Date(p.pec_inviata_at).toLocaleString("it-IT") : "—"}
        />
        <Voce t="Destinatari PEC" v={(p.pec_destinatari ?? []).join(", ") || "—"} />
      </dl>

      <div className="mt-4">
        <p className="text-xs text-slate-400">Impronta del manifesto (SHA-256)</p>
        <p className="font-mono text-xs break-all">{p.manifest_hash}</p>
        <p className={`mt-1 text-xs ${integro ? "text-emerald-700" : "text-red-600"}`}>
          {integro
            ? "Manifesto integro: l'impronta ricalcolata coincide con quella registrata."
            : "ATTENZIONE: l'impronta ricalcolata non coincide con quella registrata."}
        </p>
      </div>

      {p.pec_message_id && (
        <div className="mt-4">
          <p className="text-xs text-slate-400">Message-ID della PEC</p>
          <p className="font-mono text-xs break-all">{p.pec_message_id}</p>
        </div>
      )}

      <section className="mt-8 space-y-6">
        {m.elementi.map((e) => (
          <div key={e.ruolo} className="border-t border-slate-100 pt-4">
            <h2 className="text-sm font-semibold">{ETICHETTA[e.ruolo] ?? e.ruolo}</h2>

            {e.tipo === "file" ? (
              <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <Voce t="Nome del file" v={e.file_name} />
                <Voce t="Dimensione" v={`${e.size_bytes ?? "—"} byte`} />
                <Voce t="Caricato da" v={e.caricato_da} />
                <Voce t="Caricato il" v={e.caricato_at} />
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-400">SHA-256 del contenuto</dt>
                  <dd className="font-mono text-xs break-all">{e.sha256}</dd>
                </div>
              </dl>
            ) : (
              <>
                <p className="mt-1 break-all text-xs text-slate-400">
                  SHA-256 <span className="font-mono">{e.sha256}</span> — {e.caratteri}{" "}
                  caratteri (UTF-8)
                </p>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">
                  {e.testo}
                </pre>
              </>
            )}
          </div>
        ))}
      </section>

      <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <p>
          Il video non viaggia come allegato PEC quando supera il limite del
          gestore: a essere certificata è la sua impronta SHA-256, che lo
          identifica in modo univoco. Per verificare, scarica il file
          dall&apos;archivio e confronta{" "}
          <code className="rounded bg-slate-100 px-1">shasum -a 256 nomefile</code>{" "}
          con il valore riportato qui sopra.
        </p>
        {p.pec_ricevuta_note && <p className="mt-2">{p.pec_ricevuta_note}</p>}
      </footer>

      <p className="no-print mt-6 text-xs text-slate-400">
        Cmd/Ctrl + P per stampare o salvare in PDF.
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
