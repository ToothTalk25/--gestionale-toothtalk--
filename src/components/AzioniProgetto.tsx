"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aggiornaTesti, eliminaProgetto } from "@/app/actions";

/**
 * Azioni sul progetto: rinomina il titolo (tutti i componenti del gruppo,
 * se il progetto non è bloccato) ed eliminazione completa (solo chi ha
 * accesso globale). L'eliminazione è nascosta dietro una conferma e la RPC
 * rifiuta i progetti bloccati o già certificati via PEC.
 */
export default function AzioniProgetto({
  taskId,
  titolo,
  poloId,
  isAdmin,
}: {
  taskId: string;
  titolo: string;
  poloId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [inModifica, setInModifica] = useState(false);
  const [nuovoTitolo, setNuovoTitolo] = useState(titolo);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function salvaTitolo() {
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

  function elimina() {
    const ok = window.confirm(
      "Eliminare completamente questo progetto? Verranno rimossi i file caricati " +
        "e i materiali di lavorazione. Un progetto già certificato via PEC non può " +
        "essere eliminato. Azione irreversibile.",
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
    <div className="flex items-center gap-2">
      {inModifica ? (
        <>
          <input
            value={nuovoTitolo}
            onChange={(e) => setNuovoTitolo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") salvaTitolo();
              if (e.key === "Escape") setInModifica(false);
            }}
            autoFocus
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xl font-semibold"
          />
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
      )}

      {isAdmin && (
        <button
          onClick={elimina}
          disabled={pending}
          title="Elimina il progetto"
          className="rounded-lg border border-slate-200 p-1.5 text-slate-300 hover:border-red-200 hover:text-red-600 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}

      {errore && <span className="text-xs text-red-600">{errore}</span>}
    </div>
  );
}
