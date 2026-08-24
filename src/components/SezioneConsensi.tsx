"use client";

import { useState } from "react";
import ScaricaRicevuta from "@/components/ScaricaRicevuta";

export type RigaConsenso = {
  id: string;
  user_id: string;
  tipo: string;
  versione: string;
  accettato_at: string;
  storage_path: string | null;
  sha256: string | null;
};

/**
 * Consensi GDPR con controllo di densità:
 * - Sintesi: solo utente, tipo e data
 * - Esteso: aggiunge versione, impronta SHA-256 e la ricevuta firmata
 */
export default function SezioneConsensi({
  consensi,
  nomi,
}: {
  consensi: RigaConsenso[];
  nomi: Record<string, string>;
}) {
  const [dettaglio, setDettaglio] = useState<"sintesi" | "esteso">("sintesi");

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Consensi GDPR</h2>
          <p className="mt-1 text-xs text-slate-400">
            Ogni accettazione genera una ricevuta HTML firmata (SHA256) conservata in storage per
            audit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-[11px] py-[3px] text-xs font-semibold text-slate-600">
            {(consensi ?? []).length} ricevute
          </span>
          <select
            value={dettaglio}
            onChange={(e) => setDettaglio(e.target.value as "sintesi" | "esteso")}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-tt-blue focus:outline-none"
            title="Scegli quanto dettaglio vedere nei consensi"
          >
            <option value="sintesi">Sintesi</option>
            <option value="esteso">Esteso</option>
          </select>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto md:overflow-visible">
        <table className="tabella-mobile w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="py-2 pr-4">Utente</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Accettato il</th>
              {dettaglio === "esteso" && (
                <>
                  <th className="py-2 pr-4">Versione</th>
                  <th className="py-2 pr-4">SHA256</th>
                  <th className="py-2">Ricevuta</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {(consensi ?? []).map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="py-2 pr-4 text-xs" data-label="Utente">
                  {nomi[c.user_id] ?? c.user_id.slice(0, 8)}
                </td>
                <td className="py-2 pr-4" data-label="Tipo">
                  <span
                    className={
                      c.tipo === "privacy"
                        ? "rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700"
                        : "rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                    }
                  >
                    {c.tipo === "privacy" ? "Privacy" : "Cookie"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-xs text-slate-500" data-label="Accettato il">
                  {new Date(c.accettato_at).toLocaleString("it-IT")}
                </td>
                {dettaglio === "esteso" && (
                  <>
                    <td className="py-2 pr-4 text-xs text-slate-500" data-label="Versione">
                      {c.versione}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-400" data-label="SHA256">
                      {c.sha256 ? c.sha256.slice(0, 16) + "…" : "—"}
                    </td>
                    <td className="py-2" data-label="Ricevuta">
                      <ScaricaRicevuta consensoId={c.id} disabled={!c.storage_path} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
