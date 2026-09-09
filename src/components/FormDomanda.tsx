"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviaDomanda } from "@/app/actions-supporto";

/** Form per scrivere una nuova domanda (processo editoriale o malfunzionamento). */
export default function FormDomanda() {
  const router = useRouter();
  const [testo, setTesto] = useState("");
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  const [inviata, setInviata] = useState(false);

  function invia(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInviata(false);
    start(async () => {
      const res = await inviaDomanda(testo);
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      setTesto("");
      setInviata(true);
      router.refresh();
    });
  }

  return (
    <section className="tt-card p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Scrivi una domanda</h2>
      <p className="mt-1 text-sm text-slate-500">
        Sul processo editoriale o su un malfunzionamento del gestionale: il
        Coordinatore ti risponde qui.
      </p>
      <form onSubmit={invia} className="mt-4 space-y-2">
        <textarea
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          required
          rows={4}
          maxLength={4000}
          placeholder="Scrivi qui la tua domanda…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-tt-blue focus:outline-none focus:ring-2 focus:ring-tt-blue/20"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || !testo.trim()}
            className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? "Invio…" : "Invia"}
          </button>
          {inviata && <span className="text-xs text-emerald-700">Domanda inviata.</span>}
          {errore && <span className="text-xs text-red-600">{errore}</span>}
        </div>
      </form>
    </section>
  );
}
