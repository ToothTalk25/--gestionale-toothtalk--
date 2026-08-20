"use client";

import { useState } from "react";

/**
 * Menu a tendina per navigare tra le sezioni del Registro globale (pagina
 * admin). Mostra una sezione alla volta, così la pagina non diventa un muro
 * di tabelle. La sezione attiva resta nella tendina per non perdere il
 * contesto.
 */
export type SezioneAdmin = {
  id: string;
  etichetta: string;
  contenuto: React.ReactNode;
};

export default function NavigazioneAdmin({ sezioni }: { sezioni: SezioneAdmin[] }) {
  const [attiva, setAttiva] = useState(sezioni[0]?.id ?? "");
  const corrente = sezioni.find((s) => s.id === attiva) ?? sezioni[0];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-3 ring-1 ring-black/5 md:flex md:flex-wrap md:items-center md:gap-3">
        <label
          htmlFor="sezione-admin"
          className="mb-2 block text-sm font-medium text-slate-600 md:mb-0"
        >
          Sezione del registro
        </label>
        <select
          id="sezione-admin"
          value={corrente.id}
          onChange={(e) => setAttiva(e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-tt-blue focus:outline-none md:mb-0 md:w-auto"
        >
          {sezioni.map((s) => (
            <option key={s.id} value={s.id}>
              {s.etichetta}
            </option>
          ))}
        </select>

        {/* scorciatoie per saltare da una sezione all'altra */}
        <nav className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:ml-auto md:flex-wrap md:overflow-visible md:pb-0">
          {sezioni.map((s) => (
            <button
              key={s.id}
              onClick={() => setAttiva(s.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                s.id === corrente.id
                  ? "bg-tt-blue text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {s.etichetta}
            </button>
          ))}
        </nav>
      </div>

      {corrente?.contenuto}
    </div>
  );
}
