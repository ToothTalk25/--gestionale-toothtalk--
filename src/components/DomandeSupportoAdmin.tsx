"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rispondiDomanda } from "@/app/actions-supporto";
import type { RigaDomandaSupporto } from "@/app/actions-supporto";

/**
 * Coda delle domande dei collaboratori (sezione "Domande" lato utente).
 * Per le domande classificate "tecnica" dall'IA, il campo risposta parte
 * già precompilato con la bozza — il Coordinatore la rivede/modifica prima
 * di inviarla: non viene mai spedita automaticamente.
 */
export default function DomandeSupportoAdmin({
  domande,
  nomi,
}: {
  domande: RigaDomandaSupporto[];
  nomi: Record<string, string>;
}) {
  const pendenti = domande.filter((d) => !d.risposta);
  const risposte = domande.filter((d) => !!d.risposta);

  if (domande.length === 0) return <p className="text-sm text-slate-500">Nessuna domanda finora.</p>;

  return (
    <div className="space-y-6">
      {pendenti.length > 0 ? (
        <div className="space-y-3">
          {pendenti.map((d) => (
            <RigaPendente key={d.id} domanda={d} nome={nomi[d.user_id] ?? d.user_id.slice(0, 8)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nessuna domanda in attesa.</p>
      )}

      {risposte.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500">Già risposte</p>
          <ul className="mt-2 space-y-2">
            {risposte.map((d) => (
              <li key={d.id} className="tt-card p-3 text-xs">
                <p className="font-medium text-slate-700">{nomi[d.user_id] ?? d.user_id.slice(0, 8)}</p>
                <p className="mt-1 text-slate-600">{d.domanda}</p>
                <p className="mt-2 rounded bg-slate-50 p-2 text-slate-600">{d.risposta}</p>
                <p className="mt-1 text-slate-400">
                  {d.risposto_at ? new Date(d.risposto_at).toLocaleString("it-IT") : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RigaPendente({ domanda, nome }: { domanda: RigaDomandaSupporto; nome: string }) {
  const router = useRouter();
  const [testo, setTesto] = useState(domanda.bozza_risposta_ia ?? "");
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);

  function invia() {
    setErrore(null);
    start(async () => {
      const res = await rispondiDomanda(domanda.id, testo);
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="tt-card border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">{nome}</p>
        <span className="text-xs text-slate-400">{new Date(domanda.creato_at).toLocaleString("it-IT")}</span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{domanda.domanda}</p>

      {domanda.bozza_risposta_ia && (
        <p className="mt-2 text-xs font-medium text-tt-blue-600">
          Bozza IA precompilata sotto — rivedila prima di inviare.
        </p>
      )}

      <textarea
        value={testo}
        onChange={(e) => setTesto(e.target.value)}
        rows={3}
        placeholder="Scrivi la risposta…"
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-tt-blue focus:outline-none focus:ring-2 focus:ring-tt-blue/20"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          disabled={pending || !testo.trim()}
          onClick={invia}
          className="tt-btn bg-tt-blue px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {pending ? "Invio…" : "Invia risposta"}
        </button>
        {errore && <span className="text-xs text-red-600">{errore}</span>}
      </div>
    </div>
  );
}
