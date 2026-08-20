"use client";

import { useState } from "react";

export type RigaLiberatoria = {
  id: string;
  task_id: string | null;
  user_id: string | null;
  tipo_soggetto: string;
  tipo: string;
  nome_soggetto: string;
  email_soggetto: string | null;
  sha256: string;
  metodo_firma: string | null;
  firmato_at: string;
  is_revoked: boolean;
  revocato_at: string | null;
};

/**
 * Registro liberatorie e accordi (consents_and_releases) con controllo di
 * densità:
 * - Sintesi: soggetto, tipo e stato
 * - Esteso: aggiunge task, firma, impronta SHA-256 ed email
 */
export default function SezioneLiberatorie({
  documenti,
}: {
  documenti: RigaLiberatoria[];
}) {
  const [dettaglio, setDettaglio] = useState<"sintesi" | "esteso">("sintesi");

  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-black/5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Registro liberatorie e accordi</h2>
          <p className="mt-1 text-xs text-slate-400">
            Registro granulare (consents_and_releases): liberatorie firmate e accordi di
            collaborazione, con impronta SHA-256 e stato di revoca. Append-only: nessun documento
            viene mai cancellato.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            {(documenti ?? []).length} documenti
          </span>
          <select
            value={dettaglio}
            onChange={(e) => setDettaglio(e.target.value as "sintesi" | "esteso")}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-tt-blue focus:outline-none"
            title="Scegli quanto dettaglio vedere nel registro"
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
              <th className="py-2 pr-4">Soggetto</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Stato</th>
              {dettaglio === "esteso" && (
                <>
                  <th className="py-2 pr-4">Task</th>
                  <th className="py-2 pr-4">Firma</th>
                  <th className="py-2">SHA-256</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {(documenti ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-2 pr-4 text-xs" data-label="Soggetto">
                  <span className="font-medium">{r.nome_soggetto}</span>
                  {dettaglio === "esteso" && r.email_soggetto && (
                    <div className="text-slate-400">{r.email_soggetto}</div>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs" data-label="Tipo">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {r.tipo === "accordo_collaboratore"
                      ? "Accordo collaboratore"
                      : r.tipo_soggetto === "minore"
                        ? "Liberatoria minore"
                        : "Liberatoria"}
                  </span>
                  {r.metodo_firma && (
                    <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                      {r.metodo_firma}
                    </span>
                  )}
                </td>
                <td className="py-2 text-xs" data-label="Stato">
                  {r.is_revoked ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
                      Revocato
                      {r.revocato_at
                        ? ` · ${new Date(r.revocato_at).toLocaleDateString("it-IT")}`
                        : ""}
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-700">
                      Valido
                    </span>
                  )}
                </td>
                {dettaglio === "esteso" && (
                  <>
                    <td className="py-2 pr-4 text-xs text-slate-500" data-label="Task">
                      {r.task_id ? r.task_id.slice(0, 8) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-slate-500" data-label="Firma">
                      {new Date(r.firmato_at).toLocaleString("it-IT")}
                    </td>
                    <td className="py-2 font-mono text-xs text-slate-400" data-label="SHA-256">
                      {r.sha256.slice(0, 16)}…
                    </td>
                  </>
                )}
              </tr>
            ))}
            {(documenti ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={dettaglio === "esteso" ? 6 : 3}
                  className="py-4 text-center text-xs text-slate-400"
                >
                  Nessun documento firmato ancora.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
