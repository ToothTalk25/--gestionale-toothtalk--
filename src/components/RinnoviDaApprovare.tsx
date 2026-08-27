"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approvaRinnovoAccordo } from "@/app/actions-profilo";

export type RigaRinnovoDaApprovare = {
  id: string;
  full_name: string | null;
  email: string;
  rinnovo_caricato_at: string | null;
  accordo_scadenza: string | null;
};

/** La scadenza è passata quando è OGGI + 1 giorno (stessa regola del layout). */
function accordoScaduta(scadenza: string): boolean {
  return new Date(`${scadenza}T23:59:59`) < new Date();
}

/**
 * Sezione admin "Rinnovi da approvare" (Art. 9.1 dell'Accordo): coda dei
 * collaboratori che hanno caricato il documento di rinnovo dell'accordo
 * scaduto e attendono l'approvazione del Titolare. L'approvazione riattiva
 * l'accesso ai progetti e sposta la scadenza di 6 mesi avanti; il Modulo di
 * nomina (Documento 4) NON viene rigenerato: resta valido.
 */
export default function RinnoviDaApprovare({ rinnovi }: { rinnovi: RigaRinnovoDaApprovare[] }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  async function approva(userId: string) {
    setInCorso(userId);
    setMessaggio(null);
    const esito = await approvaRinnovoAccordo(userId);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      `Rinnovo approvato: l'accesso ai progetti è riattivato e la scadenza dell'accordo è ora il ${esito.dati.nuovaScadenza.replaceAll("-", "/")}.`,
    );
    router.refresh();
  }

  if (rinnovi.length === 0) {
    return (
      <section className="tt-card p-4 md:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Rinnovi accordo da approvare</h2>
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nessun documento di rinnovo in attesa di approvazione. ✅
        </p>
      </section>
    );
  }

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Rinnovi accordo da approvare</h2>
          <p className="mt-1 text-xs text-slate-400">
            Collaboratori con l&apos;accordo scaduto che hanno caricato il documento
            di rinnovo: la tua approvazione riattiva l&apos;accesso e sposta la
            scadenza di 6 mesi avanti (Art. 9.1).
          </p>
        </div>
        <span className="rounded-full bg-[#fef3e2] px-[11px] py-[3px] text-xs font-semibold text-amber-700">
          {rinnovi.length} in attesa
        </span>
      </div>

      {messaggio && <p className="mt-3 text-sm text-slate-600">{messaggio}</p>}

      <div className="mt-3 space-y-2">
        {rinnovi.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{r.full_name ?? "—"}</p>
                <p className="text-xs text-slate-500">{r.email}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Documento caricato il{" "}
                  {r.rinnovo_caricato_at
                    ? new Date(r.rinnovo_caricato_at).toLocaleString("it-IT")
                    : "—"}
                </p>
                {r.accordo_scadenza &&
                  (accordoScaduta(r.accordo_scadenza) ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Accordo scaduto il{" "}
                      {new Date(`${r.accordo_scadenza}T00:00:00`).toLocaleDateString("it-IT")}: accesso ai
                      progetti sospeso finché non approvi.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">
                      Scadenza attuale:{" "}
                      {new Date(`${r.accordo_scadenza}T00:00:00`).toLocaleDateString("it-IT")} — rinnovo
                      caricato in anticipo, l&apos;accesso ai progetti resta regolare.
                    </p>
                  ))}
              </div>
              <button
                onClick={() => approva(r.id)}
                disabled={inCorso === r.id}
                className="tt-btn bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {inCorso === r.id ? "Approvo…" : "Approva rinnovo"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
