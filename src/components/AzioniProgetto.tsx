"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aggiornaTesti, eliminaProgetto } from "@/app/actions";

export default function AzioniProgetto({
  taskId,
  titolo,
  poloId,
  status,
}: {
  taskId: string;
  titolo: string;
  poloId: string;
  status: string;
}) {
  const router = useRouter();
  const [inModifica, setInModifica] = useState(false);
  const [nuovoTitolo, setNuovoTitolo] = useState(titolo);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const modificabile = status === "da_fare";

  function salvaTitolo() {
    const t = nuovoTitolo.trim();
    if (!t) {
      setErrore("Il titolo non può essere vuoto.");
      return;
    }
    start(async () => {
      setErrore(null);
      setMessaggio(null);
      const esito = await aggiornaTesti(taskId, { titolo: t });
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setInModifica(false);
      if (esito.dati.avvisi.length) setMessaggio(esito.dati.avvisi.join(" · "));
      router.refresh();
    });
  }

  function elimina() {
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
      router.replace(`/polo/${poloId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {inModifica ? (
        <input
          value={nuovoTitolo}
          onChange={(e) => setNuovoTitolo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") salvaTitolo();
            if (e.key === "Escape") setInModifica(false);
          }}
          autoFocus
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-2xl font-semibold"
        />
      ) : (
        <h1 className="text-2xl font-semibold">{titolo}</h1>
      )}

      {inModifica ? (
        <>
          <button
            onClick={salvaTitolo}
            disabled={pending}
            className="rounded-lg bg-tt-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Salva
          </button>
          <button
            onClick={() => setInModifica(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          >
            Annulla
          </button>
        </>
      ) : (
        modificabile && (
          <button
            onClick={() => {
              setNuovoTitolo(titolo);
              setInModifica(true);
            }}
            title="Rinomina il progetto"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-slate-300 hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        )
      )}

      {modificabile && !inModifica && (
        <button
          onClick={elimina}
          disabled={pending}
          title="Elimina il progetto"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-300 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      )}

      {errore && <span className="text-xs text-red-600">{errore}</span>}
      {messaggio && <span className="text-xs text-emerald-700">{messaggio}</span>}
    </div>
  );
}
