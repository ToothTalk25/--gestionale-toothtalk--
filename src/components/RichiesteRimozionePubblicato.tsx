"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { risolviRichiestaRimozione, type RigaRichiestaRimozione } from "@/app/actions-profilo";

const ESITO_LABEL = {
  rimosso: "Rimosso",
  oscurato: "Oscurato",
  rifiutato: "Rifiutato",
} as const;

/**
 * Coda delle richieste di rimozione di contenuti già pubblicati (art.
 * 17(3)(a) GDPR). Aperte quando un Collaboratore revoca il consenso a
 * immagine/voce e chiede ANCHE la rimozione del pubblicato — qui il
 * Titolare registra l'esito della valutazione, non rimuove file: quella
 * resta un'azione editoriale manuale separata, coerente con l'esito scelto.
 */
export default function RichiesteRimozionePubblicato({
  richieste,
  nomi,
}: {
  richieste: RigaRichiestaRimozione[];
  nomi: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [apertaId, setApertaId] = useState<string | null>(null);
  const [motivazione, setMotivazione] = useState("");
  const [errore, setErrore] = useState<string | null>(null);

  const aperte = richieste.filter((r) => r.stato === "aperta");
  const risolte = richieste.filter((r) => r.stato === "risolta");

  function risolvi(id: string, esito: "rimosso" | "oscurato" | "rifiutato") {
    setErrore(null);
    if (!motivazione.trim()) {
      setErrore("Scrivi una motivazione prima di registrare la decisione.");
      return;
    }
    start(async () => {
      const res = await risolviRichiestaRimozione(id, esito, motivazione.trim());
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      setApertaId(null);
      setMotivazione("");
      router.refresh();
    });
  }

  return (
    <section className="tt-card p-6">
      <h2 className="text-lg font-medium">Richieste di rimozione contenuti pubblicati</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Aperte quando un Collaboratore, revocando il consenso a immagine/voce,
        chiede anche la rimozione dei contenuti già pubblicati che lo
        ritraggono. Valuta caso per caso (art. 17, par. 3, lett. a, GDPR):
        entro 30 giorni, prorogabili a 90 con motivazione scritta.
      </p>

      {aperte.length === 0 && risolte.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">Nessuna richiesta.</p>
      )}

      {aperte.length > 0 && (
        <div className="mt-4 space-y-3">
          {aperte.map((r) => {
            const scaduto = new Date(r.termine_scadenza) < new Date();
            return (
              <div key={r.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-amber-900">
                  {nomi[r.user_id] ?? r.user_id.slice(0, 8)}
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  Richiesta il {new Date(r.richiesto_at).toLocaleString("it-IT")} — termine{" "}
                  {scaduto ? "SCADUTO" : "entro"} il{" "}
                  {new Date(r.termine_scadenza).toLocaleDateString("it-IT")}
                </p>

                {apertaId === r.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={motivazione}
                      onChange={(e) => setMotivazione(e.target.value)}
                      placeholder="Motivazione della decisione (obbligatoria, resta a registro)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                      rows={3}
                    />
                    {errore && <p className="text-xs text-red-600">{errore}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={pending}
                        onClick={() => risolvi(r.id, "rimosso")}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Rimosso
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => risolvi(r.id, "oscurato")}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Oscurato
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => risolvi(r.id, "rifiutato")}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        Rifiutato (eccezione art. 17.3.a)
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => {
                          setApertaId(null);
                          setMotivazione("");
                          setErrore(null);
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-white"
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setApertaId(r.id);
                      setMotivazione("");
                      setErrore(null);
                    }}
                    className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Valuta
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {risolte.length > 0 && (
        <div className="mt-6 overflow-x-auto md:overflow-visible">
          <p className="text-xs font-medium text-slate-500">Già valutate</p>
          <table className="tabella-mobile mt-2 w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Chi</th>
                <th className="py-2 pr-4">Richiesta</th>
                <th className="py-2 pr-4">Esito</th>
                <th className="py-2">Motivazione</th>
              </tr>
            </thead>
            <tbody>
              {risolte.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4 text-xs" data-label="Chi">
                    {nomi[r.user_id] ?? r.user_id.slice(0, 8)}
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-500" data-label="Richiesta">
                    {new Date(r.richiesto_at).toLocaleDateString("it-IT")}
                  </td>
                  <td className="py-2 pr-4 text-xs" data-label="Esito">
                    {r.esito ? ESITO_LABEL[r.esito] : "—"}
                    {r.risolta_at && (
                      <span className="text-slate-400">
                        {" "}
                        · {new Date(r.risolta_at).toLocaleDateString("it-IT")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-500" data-label="Motivazione">
                    {r.esito_motivazione ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
