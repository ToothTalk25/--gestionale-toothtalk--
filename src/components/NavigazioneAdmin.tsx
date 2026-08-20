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
        <select
          id="sezione-admin"
          value={attiva}
          onChange={(e) => setAttiva(e.target.value)}
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

      {corrente && (
        <section>
          {corrente.promemoria && <PromemoriaSezione {...corrente.promemoria} />}
          {corrente.contenuto}
        </section>
      )}
    </div>
  );
}
