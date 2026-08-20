"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approvaAccordoManualmente } from "@/app/actions-profilo";

export type RigaAccordoDaApprovare = {
  id: string;
  full_name: string | null;
  email: string;
  accordo_caricato_at: string | null;
  accordo_verificato: string | null;
  accordo_verifica_note: string | null;
};

/**
 * Sezione admin "Accordi da approvare": coda dei collaboratori che hanno
 * caricato l'accordo, confermato la lettura e superato la verifica IA,
 * ma che attendono l'approvazione MANUALE del Titolare (quarta condizione
 * per sbloccare l'accesso ai progetti).
 *
 * Attenzione: se l'esito IA è 'attenzione'/'errato' il profilo non appare
 * qui (la coda filtra solo esito='ok') — ma per sicurezza mostriamo la
 * nota e un avviso se per qualsiasi motivo l'esito non è ok.
 */
export default function AccordiDaApprovare({ accordi }: { accordi: RigaAccordoDaApprovare[] }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  async function approva(userId: string) {
    setInCorso(userId);
    setMessaggio(null);
    const esito = await approvaAccordoManualmente(userId);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio("Accordo approvato: l'accesso ai progetti è sbloccato.");
    router.refresh();
  }

  if (accordi.length === 0) {
    return (
      <section className="rounded-2xl bg-white p-4 ring-1 ring-black/5 md:p-6">
        <h2 className="text-lg font-medium">Accordi da approvare</h2>
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nessun accordo in attesa di approvazione manuale. ✅
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white p-4 ring-1 ring-black/5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Accordi da approvare</h2>
          <p className="mt-1 text-xs text-slate-400">
            Collaboratori che hanno caricato l&apos;accordo, confermato la lettura e
            superato la verifica IA: manca solo la tua approvazione manuale per
            sbloccare l&apos;accesso ai progetti.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {accordi.length} in attesa
        </span>
      </div>

      {messaggio && <p className="mt-3 text-sm text-slate-600">{messaggio}</p>}

      <div className="mt-3 space-y-2">
        {accordi.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{a.full_name ?? "—"}</p>
                <p className="text-xs text-slate-500">{a.email}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Caricato il{" "}
                  {a.accordo_caricato_at
                    ? new Date(a.accordo_caricato_at).toLocaleDateString("it-IT")
                    : "—"}
                </p>
                {a.accordo_verificato && (
                  <p
                    className={`mt-1 text-xs ${
                      a.accordo_verificato === "ok"
                        ? "text-emerald-700"
                        : "text-amber-800"
                    }`}
                  >
                    <strong>IA: {a.accordo_verificato}</strong>
                    {a.accordo_verifica_note ? ` — ${a.accordo_verifica_note}` : ""}
                  </p>
                )}
                {a.accordo_verificato !== "ok" && (
                  <p className="mt-1 text-xs text-red-600">
                    ⚠️ Esito IA non &quot;ok&quot;: controlla con particolare attenzione
                    prima di approvare.
                  </p>
                )}
              </div>
              <button
                onClick={() => approva(a.id)}
                disabled={inCorso === a.id}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {inCorso === a.id ? "Approvo…" : "Approva accordo"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
