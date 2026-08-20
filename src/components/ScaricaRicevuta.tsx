"use client";

import { useState } from "react";
import { scaricaRicevutaConsenso } from "@/app/actions-profilo";

export default function ScaricaRicevuta({ consensoId, disabled }: { consensoId: string; disabled: boolean }) {
  const [loading, setLoading] = useState(false);

  async function scarica() {
    // Apre subito una scheda vuota, prima dell'await: se aspettiamo la
    // risposta del server e chiamiamo window.open() solo dopo, il browser
    // non la considera più legata al click dell'utente e la blocca in
    // silenzio come popup — nessun errore, il link semplicemente non parte.
    const finestra = window.open("", "_blank");
    setLoading(true);
    const res = await scaricaRicevutaConsenso(consensoId);
    if ("errore" in res) {
      finestra?.close();
      alert(res.errore);
      setLoading(false);
      return;
    }
    if (finestra) finestra.location.href = res.dati;
    else window.open(res.dati, "_blank");
    setLoading(false);
  }

  return (
    <button
      onClick={scarica}
      disabled={disabled || loading}
      className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
    >
      {loading ? "…" : "Scarica"}
    </button>
  );
}
