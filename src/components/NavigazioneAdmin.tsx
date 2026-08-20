"use client";

import { useRef } from "react";

/**
 * Navigazione tra le sezioni del Registro globale (pagina admin).
 *
 * A differenza di un menu che nasconde il contenuto, qui TUTTE le sezioni
 * restano visibili una sotto l'altra: il menu serve solo come scorciatoia
 * per saltare rapidamente a una sezione (scroll). Nessun contenuto viene
 * mai nascosto — è la pagina admin completa, ordinata per sezioni.
 */
export type SezioneAdmin = {
  id: string;
  etichetta: string;
  contenuto: React.ReactNode;
};

export default function NavigazioneAdmin({ sezioni }: { sezioni: SezioneAdmin[] }) {
  const riferimenti = useRef<Map<string, HTMLElement | null>>(new Map());

  function salta(id: string) {
    riferimenti.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-30 rounded-2xl bg-white/95 p-3 ring-1 ring-black/5 backdrop-blur md:flex md:flex-wrap md:items-center md:gap-3">
        <label
          htmlFor="sezione-admin"
          className="mb-2 block text-sm font-medium text-slate-600 md:mb-0"
        >
          Vai a:
        </label>
        <select
          id="sezione-admin"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) salta(e.target.value);
            e.target.value = "";
          }}
          className="mb-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-tt-blue focus:outline-none md:mb-0 md:w-auto"
        >
          <option value="">Scegli una sezione…</option>
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
              onClick={() => salta(s.id)}
              className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-tt-blue-50 hover:text-tt-blue"
            >
              {s.etichetta}
            </button>
          ))}
        </nav>
      </div>

      {sezioni.map((s) => (
        <section
          key={s.id}
          ref={(el) => {
            riferimenti.current.set(s.id, el);
          }}
        >
          {s.contenuto}
        </section>
      ))}
    </div>
  );
}

