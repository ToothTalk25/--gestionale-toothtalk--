"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aggiornaTesti, eliminaProgetto } from "@/app/actions";

export default function AzioniProgettoRiga({
  taskId,
  titolo,
  poloId,
}: {
  taskId: string;
  titolo: string;
  poloId: string;
}) {
  const router = useRouter();
  const [inModifica, setInModifica] = useState(false);
  const [nuovoTitolo, setNuovoTitolo] = useState(titolo);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvaTitolo(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const t = nuovoTitolo.trim();
    if (!t) {
      setErrore("Il titolo non può essere vuoto.");
      return;
    }
    start(async () => {
      setErrore(null);
      const esito = await aggiornaTesti(taskId, { titolo: t });
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setInModifica(false);
      router.refresh();
    });
  }

  function elimina(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      "Eliminare questo progetto? Verranno rimossi tutti i file caricati. Azione irreversibile.",
    );
    if (!ok) return;

    start(async () => {
      setErrore(null);
      const esito = await eliminaProgetto(taskId);
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      router.refresh();
    });
  }

  if (inModifica) {
    return (
      <span className="flex items-center gap-2" onClick={(e) => e.preventDefault()}>
        <input
          value={nuovoTitolo}
          onChange={(e) => setNuovoTitolo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              salvaTitolo(e as unknown as React.MouseEvent);
            }
            if (e.key === "Escape") setInModifica(false);
          }}
          autoFocus
          onClick={(e) => e.preventDefault()}
          className="rounded border border-slate-300 px-2 py-1 text-sm font-medium"
        />
        <button
          onClick={salvaTitolo}
          disabled={pending}
          className="rounded bg-tt-ink px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Salva
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInModifica(false); }}
          className="rounded border border-slate-300 px-2 py-1 text-xs"
        >
          Annulla
        </button>
        {errore && <span className="text-xs text-red-600">{errore}</span>}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setNuovoTitolo(titolo);
          setInModifica(true);
        }}
        title="Rinomina"
        className="rounded border border-slate-200 p-1 text-slate-300 hover:border-slate-300 hover:text-slate-600"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      </button>
      <button
        onClick={elimina}
        disabled={pending}
        title="Elimina"
        className="rounded border border-slate-200 p-1 text-slate-300 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    </span>
  );
}
