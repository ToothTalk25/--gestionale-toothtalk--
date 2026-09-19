"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import PromemoriaSezione from "@/components/PromemoriaSezione";

/**
 * Navigazione tra le sezioni del Registro globale (pagina admin).
 *
 * Mostra UNA sola sezione alla volta — non l'intera pagina con tutto scritto
 * uno sotto l'altro.
 *
 * La sezione scelta sta nell'INDIRIZZO (`?sezione=…`) e non nello stato del
 * browser: il server deve sapere cosa serve PRIMA di disegnare, altrimenti per
 * mostrarne una ne disegna diciotto e le spedisce tutte — ed era esattamente
 * questo il costo del Registro (misurato: 1,3-1,5 secondi per aprirlo, contro
 * i 500-800 ms delle altre pagine).
 *
 * Il cambio passa da `router.push`: è una navigazione dentro l'app (decine di
 * millisecondi, con la pagina già pronta in parte), non un ricaricamento. Il
 * tasto indietro del browser torna alla sezione precedente, come ci si aspetta.
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

export default function NavigazioneAdmin({
  sezioni,
  sezione,
}: {
  sezioni: SezioneAdmin[];
  sezione: string;
}) {
  const router = useRouter();
  const [inCorso, inizia] = useTransition();
  const corrente = sezioni.find((s) => s.id === sezione) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 tt-card p-3">
        <label htmlFor="sezione-admin" className="text-sm font-medium text-slate-600">
          Vai a:
        </label>
        <div className="relative w-full md:w-auto">
          <select
            id="sezione-admin"
            value={sezione}
            onChange={(e) => {
              const scelta = e.target.value;
              inizia(() => {
                router.push(scelta ? `/admin?sezione=${scelta}` : "/admin");
              });
            }}
            className={`w-full appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-sm text-slate-700 focus:border-tt-blue focus:outline-none focus:ring-2 focus:ring-tt-blue/20 md:w-auto md:min-w-[220px] ${
              inCorso ? "opacity-60" : ""
            }`}
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
