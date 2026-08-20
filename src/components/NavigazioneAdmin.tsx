"use client";

import { useRef } from "react";
import PromemoriaSezione from "@/components/PromemoriaSezione";

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
  /** Cosa si fa in questa sezione — mostrato in un promemoria in cima. */
  promemoria?: { cosa: string; attenzione?: string };
  contenuto: React.ReactNode;
};

export default function NavigazioneAdmin({ sezioni }: { sezioni: SezioneAdmin[] }) {
  const riferimenti = useRef<Map<string, HTMLElement | null>>(new Map());

  function salta(id: string) {
    riferimenti.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-16 z-30 flex items-center gap-3 rounded-2xl bg-white/95 p-3 ring-1 ring-black/5 backdrop-blur">
        <label htmlFor="sezione-admin" className="text-sm font-medium text-slate-600">
          Vai a:
        </label>
        <select
          id="sezione-admin"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) salta(e.target.value);
            e.target.value = "";
          }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-tt-blue focus:outline-none md:w-auto"
        >
          <option value="">Scegli una sezione…</option>
          {sezioni.map((s) => (
            <option key={s.id} value={s.id}>
              {s.etichetta}
            </option>
          ))}
        </select>
      </div>

      {sezioni.map((s) => (
        <section
          key={s.id}
          ref={(el) => {
            riferimenti.current.set(s.id, el);
          }}
        >
          {s.promemoria && <PromemoriaSezione {...s.promemoria} />}
          {s.contenuto}
        </section>
      ))}
    </div>
  );
}

