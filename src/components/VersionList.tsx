"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eliminaVersione, urlFirmato } from "@/app/actions";
import { formatBytes } from "@/lib/hash";
import { IconaAnnulla, IconaConferma, IconaElimina, IconaScarica, IconaSpinner } from "@/components/icone-azioni";
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

      <div className="mt-1.5 flex items-center gap-1">
        <button
          onClick={scarica}
          disabled={inCorso}
          title="Scarica"
          aria-label="Scarica"
          className="rounded-md p-1.5 text-tt-blue hover:bg-tt-blue-50 disabled:opacity-50"
        >
          {inCorso ? <IconaSpinner /> : <IconaScarica />}
        </button>

        {confermaElimina ? (
          <>
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
              title="Conferma eliminazione"
              aria-label="Conferma eliminazione"
              className="rounded-md bg-red-600 p-1.5 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? <IconaSpinner /> : <IconaConferma />}
            </button>
            <button
              onClick={() => setConfermaElimina(false)}
              title="Annulla"
              aria-label="Annulla"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200"
            >
              <IconaAnnulla />
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfermaElimina(true)}
            title="Elimina"
            aria-label="Elimina"
            className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          >
            <IconaElimina />
          </button>
        )}
      </div>

      {errore && <p className="mt-1.5 text-xs text-red-600">{errore}</p>}
    </li>
  );
}
