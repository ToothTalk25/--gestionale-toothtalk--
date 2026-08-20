"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { creaCodiceInvito, disattivaCodiceInvito } from "@/app/actions-invito";
import type { Polo } from "@/lib/types";

export type RigaInvito = {
  id: string;
  codice: string;
  polo_id: string;
  gruppo: string;
  attivo: boolean;
  usi: number;
  max_usi: number | null;
  scade_il: string | null;
  utilizzabile: boolean;
};

export default function GestioneInviti({
  poli,
  inviti,
}: {
  poli: Polo[];
  inviti: RigaInvito[];
}) {
  const router = useRouter();
  const [poloId, setPoloId] = useState(poli[0]?.id ?? "");
  const [maxUsi, setMaxUsi] = useState("");
  const [scadenza, setScadenza] = useState("");
  const [nuovo, setNuovo] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const attivi = inviti.filter((i) => i.attivo);

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
      <h2 className="text-lg font-medium">Codici di ingresso</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Un codice per gruppo. Lo condividi con loro una volta sola: chi lo usa
        crea il proprio account ed entra automaticamente in quel gruppo, senza
        che tu debba fare altro. Rigenerandolo, il precedente smette subito di
        funzionare.
      </p>

      {/* ------------------------------------------------ codici attivi */}
      {attivi.length > 0 && (
        <div className="mt-4 overflow-x-auto md:overflow-visible">
          <table className="tabella-mobile w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Gruppo</th>
                <th className="py-2 pr-4">Codice</th>
                <th className="py-2 pr-4">Usi</th>
                <th className="py-2 pr-4">Scadenza</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {attivi.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4" data-label="Gruppo">{i.gruppo}</td>
                  <td className="py-2 pr-4 font-mono font-medium" data-label="Codice">{i.codice}</td>
                  <td className="py-2 pr-4" data-label="Usi">
                    {i.usi}
                    {i.max_usi ? ` / ${i.max_usi}` : ""}
                  </td>
                  <td className="py-2 pr-4 text-xs" data-label="Scadenza">
                    {i.scade_il
                      ? new Date(i.scade_il).toLocaleDateString("it-IT")
                      : "—"}
                  </td>
                  <td className="py-2 text-right" data-label="Azioni">
                    {!i.utilizzabile && (
                      <span className="mr-3 text-xs text-amber-700">
                        non più utilizzabile
                      </span>
                    )}
                    <button
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const e = await disattivaCodiceInvito(i.id);
                          if (!e.ok) setErrore(e.errore);
                          else router.refresh();
                        })
                      }
                      className="text-xs text-slate-400 hover:text-red-600 hover:underline"
                    >
                      Disattiva
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* -------------------------------------------------- generazione */}
      <div className="mt-6 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Gruppo
            <select
              value={poloId}
              onChange={(e) => setPoloId(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              {poli.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-500">
            Max ingressi (facoltativo)
            <input
              type="number"
              min={1}
              value={maxUsi}
              onChange={(e) => setMaxUsi(e.target.value)}
              placeholder="illimitati"
              className="mt-1 block w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          <label className="text-xs text-slate-500">
            Scadenza (facoltativa)
            <input
              type="date"
              value={scadenza}
              onChange={(e) => setScadenza(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          <button
            disabled={pending || !poloId}
            onClick={() =>
              start(async () => {
                setErrore(null);
                setNuovo(null);
                const esito = await creaCodiceInvito(
                  poloId,
                  maxUsi ? Number(maxUsi) : null,
                  scadenza ? new Date(scadenza + "T23:59:59").toISOString() : null,
                );
                if (!esito.ok) setErrore(esito.errore);
                else {
                  setNuovo(esito.dati.codice);
                  router.refresh();
                }
              })
            }
            className="rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {pending ? "Genero…" : "Genera codice"}
          </button>
        </div>

        {nuovo && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Nuovo codice: <strong className="font-mono">{nuovo}</strong> — mandalo
            al gruppo. Se ce n&apos;era uno precedente, ora non funziona più.
          </p>
        )}
        {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
      </div>
    </section>
  );
}
