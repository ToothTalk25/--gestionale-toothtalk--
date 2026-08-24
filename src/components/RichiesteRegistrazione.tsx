"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approvaRegistrazione } from "@/app/actions-profilo";
import EliminaAccountAdmin from "@/components/EliminaAccountAdmin";

export type RigaRichiestaRegistrazione = {
  id: string;
  full_name: string | null;
  email: string;
  pec: string | null;
  on_screen: boolean;
};

/**
 * Sezione admin "Richieste di registrazione": gli account creati ma non
 * ancora approvati (attivo=false). L'admin conferma/corregge il flag
 * "appare in video" (serve per la correttezza della revoca GDPR, non per
 * scegliere un accordo — l'accordo è unico per tutti) e approva. Chi non
 * viene approvato si elimina con il componente esistente EliminaAccountAdmin.
 */
export default function RichiesteRegistrazione({
  richieste,
}: {
  richieste: RigaRichiestaRegistrazione[];
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  // Flag on_screen corrente per ogni richiesta, correggibile dall'admin.
  const [onScreen, setOnScreen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(richieste.map((r) => [r.id, r.on_screen])),
  );

  async function approva(userId: string) {
    setInCorso(userId);
    setMessaggio(null);
    const esito = await approvaRegistrazione(userId, onScreen[userId] ?? false);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio("Registrazione approvata: la PEC con l'accordo è partita.");
    router.refresh();
  }

  if (richieste.length === 0) {
    return (
      <section className="tt-card p-4 md:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Richieste di registrazione</h2>
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nessuna richiesta in attesa di approvazione. ✅
        </p>
      </section>
    );
  }

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Richieste di registrazione</h2>
          <p className="mt-1 text-xs text-slate-400">
            Account creati ma non ancora attivi. Conferma se la persona appare in video
            (o no) e approva: l&apos;accordo editoriale parte via PEC al momento
            dell&apos;approvazione.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {richieste.length} in attesa
        </span>
      </div>

      {messaggio && <p className="mt-3 text-sm text-slate-600">{messaggio}</p>}

      <div className="mt-3 space-y-2">
        {richieste.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-slate-200 p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{r.full_name ?? "—"}</p>
                <p className="text-xs text-slate-500">{r.email}</p>
                {r.pec && <p className="font-mono text-xs text-slate-400">{r.pec}</p>}
              </div>

              <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
                  <button
                    onClick={() =>
                      setOnScreen((s) => ({ ...s, [r.id]: true }))
                    }
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      onScreen[r.id]
                        ? "bg-tt-blue text-white"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                    title="Appare in video (serve per la revoca GDPR)"
                  >
                    📹 In video
                  </button>
                  <button
                    onClick={() =>
                      setOnScreen((s) => ({ ...s, [r.id]: false }))
                    }
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      !onScreen[r.id]
                        ? "bg-tt-blue text-white"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                    title="Non appare in video (backstage)"
                  >
                    🎨 Backstage
                  </button>
                </div>

                <button
                  onClick={() => approva(r.id)}
                  disabled={inCorso === r.id}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {inCorso === r.id ? "Approvo…" : "Approva"}
                </button>

                <EliminaAccountAdmin userId={r.id} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
