"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rispondiDomandaTecnica } from "@/app/actions-domande-tecnico";

export type RigaDomandaTecnica = {
  id: string;
  user_id: string;
  domanda: string;
  creato_at: string;
  risposta: string | null;
  risposto_at: string | null;
};

/**
 * Coda delle domande tecniche, per il Collaboratore Tecnico (/tecnico).
 *
 * Di chi scrive si mostra SOLO il nome di battesimo: la funzione
 * nome_battesimo (migrazione 0134) è l'unico modo per leggerlo e non
 * restituisce nient'altro — nessun cognome, nessuna email (Documento 5,
 * Art. 8.2, minimizzazione).
 *
 * La risposta inviata da qui arriva direttamente a chi ha chiesto: la vede
 * nel proprio widget delle domande come le altre risposte.
 */
export default function PannelloDomandeTecniche({
  domande,
  nomi,
}: {
  domande: RigaDomandaTecnica[];
  nomi: Record<string, string>;
}) {
  const inAttesa = domande.filter((d) => !d.risposta);
  const risposte = domande.filter((d) => !!d.risposta);

  if (domande.length === 0) {
    return (
      <p className="tt-card p-4 text-sm text-slate-500">
        Nessuna domanda tecnica per ora. Quando un Collaboratore ne scrive una,
        arriva qui.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {inAttesa.length > 0 ? (
        <div className="space-y-3">
          {inAttesa.map((d) => (
            <RigaAperta key={d.id} domanda={d} nome={nomi[d.user_id] ?? "—"} />
          ))}
        </div>
      ) : (
        <p className="tt-card p-4 text-sm text-slate-500">
          Nessuna domanda in attesa: hai risposto a tutte.
        </p>
      )}

      {risposte.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500">Domande già risposte</p>
          <ul className="mt-2 space-y-2">
            {risposte.map((d) => (
              <li key={d.id} className="tt-card p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-700">{nomi[d.user_id] ?? "—"}</p>
                  <span className="text-slate-400">
                    {new Date(d.risposto_at ?? d.creato_at).toLocaleString("it-IT")}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{d.domanda}</p>
                <p className="mt-2 rounded bg-tt-blue-50 p-2 text-slate-600">
                  <span className="font-medium">Risposta: </span>
                  {d.risposta}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RigaAperta({ domanda, nome }: { domanda: RigaDomandaTecnica; nome: string }) {
  const router = useRouter();
  const [testo, setTesto] = useState("");
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);

  function invia() {
    setErrore(null);
    start(async () => {
      const res = await rispondiDomandaTecnica(domanda.id, testo);
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      setTesto("");
      router.refresh();
    });
  }

  return (
    <div className="tt-card border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">{nome}</p>
        <span className="text-xs text-slate-400">
          {new Date(domanda.creato_at).toLocaleString("it-IT")}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{domanda.domanda}</p>

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
        <span className="text-xs text-slate-500">Arriva subito a chi l&apos;ha scritta.</span>
        {errore && <span className="text-xs text-red-600">{errore}</span>}
      </div>
    </div>
  );
}
