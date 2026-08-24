"use client";

import { useState } from "react";

export type RigaAudit = {
  id: number;
  at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  meta: Record<string, unknown>;
};

/**
 * Log delle operazioni (audit_log) con controllo di densità:
 * - Sintesi: solo data, azione, soggetto (per la panoramica rapida)
 * - Esteso: aggiunge entità, id, file e meta (per l'accountability completa)
 */
export default function SezioneAudit({
  audit,
  nomi,
}: {
  audit: RigaAudit[];
  nomi: Record<string, string>;
}) {
  const [dettaglio, setDettaglio] = useState<"sintesi" | "esteso">("sintesi");
  const [limite, setLimite] = useState(15);

  const visibili = audit.slice(0, limite);

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Log delle operazioni</h2>
          <p className="mt-1 text-xs text-slate-400">
            Catena di hash immutabile: ogni voce è sigillata sul registro append-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {audit.length} voci
          </span>
          <select
            value={dettaglio}
            onChange={(e) => setDettaglio(e.target.value as "sintesi" | "esteso")}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-tt-blue focus:outline-none"
            title="Scegli quanto dettaglio vedere nel log"
          >
            <option value="sintesi">Sintesi</option>
            <option value="esteso">Esteso</option>
          </select>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {visibili.map((a) => (
          <li key={a.id} className="border-b border-slate-50 py-1">
            <span className="text-xs text-slate-400">
              {new Date(a.at).toLocaleString("it-IT")}
            </span>{" "}
            <strong>{a.action}</strong>{" "}
            <span className="text-slate-500">
              {a.entity_type}
              {a.actor ? ` · ${nomi[a.actor] ?? a.actor}` : ""}
            </span>
            {dettaglio === "esteso" && (
              <>
                {typeof a.meta?.file_name === "string" && (
                  <span className="text-slate-400"> · {a.meta.file_name as string}</span>
                )}
                {a.entity_id && (
                  <span className="font-mono text-xs text-slate-400">
                    {" "}
                    · id {a.entity_id.slice(0, 8)}
                  </span>
                )}
                {Object.keys(a.meta).length > 0 && (
                  <span className="mt-0.5 block break-all font-mono text-[11px] text-slate-400">
                    {JSON.stringify(a.meta)}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {audit.length > limite && (
        <button
          onClick={() => setLimite(limite + 30)}
          className="mt-3 rounded border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Mostra altre {Math.min(30, audit.length - limite)} voci…
        </button>
      )}
    </section>
  );
}
