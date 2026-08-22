"use client";

import { useState } from "react";
import PromemoriaSezione from "@/components/PromemoriaSezione";

/**
 * Navigazione tra le sezioni del Registro globale (pagina admin).
 *
 * Mostra UNA sola sezione alla volta, scelta dalla tendina "Vai a:" — non
 * l'intera pagina con tutto scritto uno sotto l'altro. Finché non si
 * seleziona nulla, non c'è nessuna sezione a schermo.
 */
export type SezioneAdmin = {
  id: string;
  etichetta: string;
  /** Cosa si fa in questa sezione — mostrato in un promemoria in cima. */
  promemoria?: { cosa: string; attenzione?: string };
  /** Contatore da mostrare accanto alla voce (es. richieste aperte). */
  badge?: number;
  contenuto: React.ReactNode;
};

export default function NavigazioneAdmin({ sezioni }: { sezioni: SezioneAdmin[] }) {
  const [attiva, setAttiva] = useState<string>("");
  const corrente = sezioni.find((s) => s.id === attiva) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-black/5">
        <label htmlFor="sezione-admin" className="text-sm font-medium text-slate-600">
          Vai a:
        </label>
        <div className="relative w-full md:w-auto">
          <select
            id="sezione-admin"
            value={attiva}
            onChange={(e) => setAttiva(e.target.value)}
            className="w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm text-slate-700 focus:border-tt-blue focus:outline-none focus:ring-2 focus:ring-tt-blue/20 md:w-auto md:min-w-[220px]"
          >
            <option value="">Scegli una sezione…</option>
            {sezioni.map((s) => (
              <option key={s.id} value={s.id}>
                {s.etichetta}
                {s.badge ? ` (${s.badge})` : ""}
              </option>
            ))}
          </select>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      </div>

      {corrente && (
        <section>
          {corrente.promemoria && <PromemoriaSezione {...corrente.promemoria} />}
          {corrente.contenuto}
        </section>
      )}
    </div>
  );
}
