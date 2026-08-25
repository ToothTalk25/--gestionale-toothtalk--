"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eliminaDichiarazione, urlDichiarazione } from "@/app/actions-pacchetto";
import { useConferma } from "@/components/ConfermaAzione";

/**
 * Controlli riservati al Coordinatore per i video di dichiarazione (slot
 * 7/7b del "Video completo"): vedere (player inline), scaricare ed
 * eliminare liberando il campo per il Collaboratore. Il Collaboratore non
 * vede né scarica mai il file (RLS 0109): queste icone compaiono solo
 * nella vista admin.
 */

export type RuoloDichiarazione = "dichiarazione_identita" | "dichiarazione_integrazione";

export default function ControlliAdminDichiarazione({
  pacchettoId,
  ruolo,
}: {
  pacchettoId: string;
  ruolo: RuoloDichiarazione;
}) {
  const router = useRouter();
  const [link, setLink] = useState<{ url: string; urlDownload: string } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const { chiedi, dialogo } = useConferma();

  async function vedi() {
    setErrore(null);
    const esito = await urlDichiarazione(pacchettoId, ruolo);
    if (!esito.ok) return setErrore(esito.errore);
    // Un secondo click sull'occhio chiude il player.
    setLink((l) => (l?.url === esito.dati.url ? null : esito.dati));
  }

  async function scarica() {
    setErrore(null);
    const esito = await urlDichiarazione(pacchettoId, ruolo);
    if (!esito.ok) return setErrore(esito.errore);
    window.location.href = esito.dati.urlDownload;
  }

  async function elimina() {
    const confermato = await chiedi({
      titolo: "Eliminare il video di dichiarazione?",
      descrizione:
        "Il file viene cancellato e il campo torna libero: il Collaboratore potrà ricaricarlo.",
      peso: "grave",
      testoConferma: "Elimina video",
    });
    if (!confermato) return;
    setErrore(null);
    const esito = await eliminaDichiarazione(pacchettoId, ruolo);
    if (!esito.ok) return setErrore(esito.errore);
    router.refresh();
  }

  const classeIcona =
    "rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-slate-300 hover:text-slate-600";
  const classeIconaPericolosa =
    "rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-red-200 hover:text-red-600";

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={vedi} title={link ? "Nascondi il video" : "Vedi il video"} className={classeIcona}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="sr-only">Vedi il video di dichiarazione</span>
        </button>
        <button onClick={scarica} title="Scarica il video" className={classeIcona}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span className="sr-only">Scarica il video di dichiarazione</span>
        </button>
        <button onClick={elimina} title="Elimina e libera il campo" className={classeIconaPericolosa}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          </svg>
          <span className="sr-only">Elimina il video di dichiarazione e libera il campo</span>
        </button>
        <span className="text-[11px] text-slate-400">Visibile solo al Coordinatore</span>
      </div>

      {link && (
        <video
          key={link.url}
          controls
          playsInline
          src={link.url}
          className="mt-2 w-full max-w-xs rounded-lg bg-slate-900"
        />
      )}
      {errore && <p className="mt-1 text-xs text-red-600">{errore}</p>}
      {dialogo}
    </div>
  );
}
