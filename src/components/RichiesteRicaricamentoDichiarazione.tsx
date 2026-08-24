"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { liberaCampoDichiarazione } from "@/app/actions-pacchetto";

/** Riga del registro "richieste di ricaricamento video di dichiarazione". */
export type RigaRicaricamentoDichiarazione = {
  id: string;
  user_id: string;
  pacchetto_id: string;
  ruolo: string;
  motivo: string | null;
  stato: "aperta" | "risolta";
  creato_at: string;
  risolta_da: string | null;
  risolta_at: string | null;
};

/**
 * "Segnala errore" sul video di dichiarazione (Protocollo Art. 4.1): chi lo
 * ha caricato per errore apre una richiesta; il Coordinatore libera il campo
 * (cancella il vecchio file) e la persona può ricaricare quello corretto.
 */
export default function RichiesteRicaricamentoDichiarazione({
  richieste,
  nomi,
}: {
  richieste: RigaRicaricamentoDichiarazione[];
  nomi: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);

  const aperte = richieste.filter((r) => r.stato === "aperta");
  const risolte = richieste.filter((r) => r.stato === "risolta");

  if (aperte.length === 0 && risolte.length === 0) return null;

  function libera(id: string) {
    setErrore(null);
    start(async () => {
      const res = await liberaCampoDichiarazione(id);
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-amber-200">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Richieste di ricaricamento video di dichiarazione</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Chi ha caricato per errore il video di dichiarazione può segnalarlo.
        Qui liberi il campo: il vecchio file viene cancellato e la persona può
        ricaricare quello corretto.
      </p>

      {aperte.map((r) => (
        <div
          key={r.id}
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
        >
          <div>
            <p className="font-medium text-amber-900">
              {nomi[r.user_id] ?? r.user_id.slice(0, 8)}
            </p>
            <p className="text-xs text-amber-700">
              {r.ruolo === "dichiarazione_integrazione"
                ? "Video di integrazione (domanda aggiuntiva) · "
                : "Video di dichiarazione · "}
              Segnalato il {new Date(r.creato_at).toLocaleDateString("it-IT")}
              {r.motivo ? ` — "${r.motivo}"` : ""}
            </p>
          </div>
          <button
            disabled={pending}
            onClick={() => libera(r.id)}
            className="tt-btn bg-amber-700 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            Libera il campo (consenti ricaricamento)
          </button>
        </div>
      ))}

      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}

      {risolte.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">Già evase</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {risolte.map((r) => (
              <li key={r.id}>
                {nomi[r.user_id] ?? r.user_id.slice(0, 8)} — liberata il{" "}
                {r.risolta_at ? new Date(r.risolta_at).toLocaleDateString("it-IT") : "?"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
