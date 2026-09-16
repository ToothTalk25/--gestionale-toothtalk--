"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rispondiDomanda } from "@/app/actions-supporto";
import type { RigaDomandaSupporto } from "@/app/actions-supporto";

/**
 * Coda delle domande dei collaboratori (widget chat lato utente). Le
 * domande "tecniche" NON ricevono più una risposta autonoma dell'IA:
 * vengono inoltrate via email ai Collaboratori Tecnici attivi
 * (/admin/tecnico), e tornano qui "da gestire" come tutte le altre — è
 * l'accesso globale a incollare la risposta ricevuta in rispondiDomanda().
 * Restano nella sezione "risposte automatiche" SOLO le righe storiche da
 * prima di questo cambio, che hanno già una bozza dell'IA salvata: quelle
 * erano già state mostrate al collaboratore come risposta, non ha senso
 * rimetterle in coda.
 */
export default function DomandeSupportoAdmin({
  domande,
  nomi,
}: {
  domande: RigaDomandaSupporto[];
  nomi: Record<string, string>;
}) {
  const rispostaAutomaticaStorica = (d: RigaDomandaSupporto) =>
    d.categoria_ia === "tecnica" && !!d.bozza_risposta_ia && !d.richiede_coordinatore;

  const daGestire = domande.filter((d) => !d.risposta && !rispostaAutomaticaStorica(d));
  const risposteAutomatiche = domande.filter((d) => !d.risposta && rispostaAutomaticaStorica(d));
  const risposteCoordinatore = domande.filter((d) => !!d.risposta);

  if (domande.length === 0) return <p className="text-sm text-slate-500">Nessuna domanda finora.</p>;

  return (
    <div className="space-y-6">
      {daGestire.length > 0 ? (
        <div className="space-y-3">
          {daGestire.map((d) => (
            <RigaPendente key={d.id} domanda={d} nome={nomi[d.user_id] ?? d.user_id.slice(0, 8)} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Nessuna domanda da gestire.</p>
      )}

      {risposteAutomatiche.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500">
            Risposte automatiche dell&apos;IA (nessuna richiesta di intervento)
          </p>
          <ul className="mt-2 space-y-2">
            {risposteAutomatiche.map((d) => (
              <li key={d.id} className="tt-card p-3 text-xs">
                <p className="font-medium text-slate-700">{nomi[d.user_id] ?? d.user_id.slice(0, 8)}</p>
                <p className="mt-1 text-slate-600">{d.domanda}</p>
                <p className="mt-2 rounded bg-tt-blue-50 p-2 text-slate-600">{d.bozza_risposta_ia}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {risposteCoordinatore.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500">Già risposte da te</p>
          <ul className="mt-2 space-y-2">
            {risposteCoordinatore.map((d) => (
              <li key={d.id} className="tt-card p-3 text-xs">
                <p className="font-medium text-slate-700">{nomi[d.user_id] ?? d.user_id.slice(0, 8)}</p>
                <p className="mt-1 text-slate-600">{d.domanda}</p>
                {d.bozza_risposta_ia && (
                  <p className="mt-2 rounded bg-tt-blue-50 p-2 text-slate-500">
                    <span className="font-medium">IA: </span>
                    {d.bozza_risposta_ia}
                  </p>
                )}
                <p className="mt-2 rounded bg-slate-50 p-2 text-slate-600">
                  <span className="font-medium">Tu: </span>
                  {d.risposta}
                </p>
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
  const [testo, setTesto] = useState("");
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

      {domanda.richiede_coordinatore && (
        <p className="mt-1 text-xs font-medium text-amber-700">
          Il collaboratore ha chiesto esplicitamente di parlare con te.
        </p>
      )}
      {domanda.categoria_ia === "tecnica" && !domanda.bozza_risposta_ia && (
        <p className="mt-1 text-xs text-slate-500">
          Inoltrata via email ai Collaboratori Tecnici attivi: incolla qui la
          risposta che ti mandano.
        </p>
      )}
      {domanda.bozza_risposta_ia && (
        <p className="mt-2 rounded bg-tt-blue-50 p-2 text-xs text-slate-600">
          <span className="font-medium">L&apos;IA ha già risposto: </span>
          {domanda.bozza_risposta_ia}
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
