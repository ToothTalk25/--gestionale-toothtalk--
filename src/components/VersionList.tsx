"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eliminaVersione, urlFirmato } from "@/app/actions";
import { formatBytes } from "@/lib/hash";
import type { DeliverableVersion } from "@/lib/types";

/**
 * Elenco dei file di uno spazio di lavoro.
 *
 * Qui non c'è niente da certificare: è il posto dove si scambiano girato
 * grezzo, bozze e materiali di servizio. Lista piatta in ordine di
 * caricamento, ognuno scarica, corregge, ricarica ed elimina.
 * Il video completo — l'unica cosa che viene certificata — sta altrove.
 */
export default function VersionList({
  taskId,
  versioni,
  nomi,
}: {
  taskId: string;
  versioni: DeliverableVersion[];
  nomi: Record<string, string>;
  deliverableId?: string;
}) {
  if (!versioni.length) {
    return <p className="mt-3 text-sm text-slate-400">Nessun file caricato.</p>;
  }

  const ordinate = [...versioni].sort(
    (a, b) => +new Date(b.uploaded_at) - +new Date(a.uploaded_at),
  );

  return (
    <ul className="mt-3 space-y-2">
      {ordinate.map((v) => (
        <Riga key={v.id} v={v} nomi={nomi} taskId={taskId} />
      ))}
    </ul>
  );
}

function Riga({
  v,
  nomi,
  taskId,
}: {
  v: DeliverableVersion;
  nomi: Record<string, string>;
  taskId: string;
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [confermaElimina, setConfermaElimina] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function scarica() {
    setInCorso(true);
    setErrore(null);
    const esito = await urlFirmato(v.bucket, v.storage_path);
    setInCorso(false);
    if (!esito.ok) {
      setErrore(esito.errore);
      return;
    }
    window.location.href = esito.dati.url;
  }

  return (
    <li className="rounded-lg bg-slate-50 p-2.5 text-left">
      <p className="truncate text-sm" title={v.file_name}>
        {v.file_name}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-slate-400">
        {formatBytes(v.size_bytes)} ·{" "}
        {new Date(v.uploaded_at).toLocaleString("it-IT")} ·{" "}
        {nomi[v.uploaded_by] ?? "—"}
      </p>

      <div className="mt-1.5 flex items-center gap-3 text-xs">
        <button
          onClick={scarica}
          disabled={inCorso}
          className="text-tt-blue hover:underline disabled:opacity-50"
        >
          {inCorso ? "…" : "Scarica"}
        </button>

        {confermaElimina ? (
          <span className="flex items-center gap-1.5">
            <span className="text-slate-500">Eliminare?</span>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErrore(null);
                  const esito = await eliminaVersione(taskId, v.id);
                  if (!esito.ok) {
                    setErrore(esito.errore);
                    setConfermaElimina(false);
                  } else {
                    router.refresh();
                  }
                })
              }
              className="font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              {pending ? "…" : "Sì, elimina"}
            </button>
            <button
              onClick={() => setConfermaElimina(false)}
              className="text-slate-500 hover:underline"
            >
              Annulla
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfermaElimina(true)}
            className="text-slate-400 hover:text-red-600 hover:underline"
          >
            Elimina
          </button>
        )}
      </div>

      {errore && <p className="mt-1.5 text-xs text-red-600">{errore}</p>}
    </li>
  );
}
