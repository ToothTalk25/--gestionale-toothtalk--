"use client";

import { useState, useTransition } from "react";
import { inviaLinkOnboarding } from "@/app/actions-onboarding";

/**
 * Invia via email, a un indirizzo qualsiasi (non serve un profilo già
 * esistente), il link del gestionale con le istruzioni per installarlo come
 * PWA su iPhone/Android/Mac/Windows — pensato per l'onboarding di chi deve
 * ancora registrarsi.
 */
export default function InviaLinkOnboarding() {
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);
  const [inviataA, setInviataA] = useState<string | null>(null);

  function invia(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setInviataA(null);
    start(async () => {
      const res = await inviaLinkOnboarding(email);
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      setInviataA(email);
      setEmail("");
    });
  }

  return (
    <section className="tt-card p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Invia link di accesso</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Manda a un indirizzo email il link del gestionale, con le istruzioni per
        installarlo come app su iPhone, Android, Mac e Windows.
      </p>

      <form onSubmit={invia} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@esempio.it"
          className="w-full flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-tt-blue focus:outline-none focus:ring-2 focus:ring-tt-blue/20 md:w-auto"
        />
        <button
          type="submit"
          disabled={pending || !email}
          className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "Invio…" : "Invia"}
        </button>
      </form>

      {inviataA && (
        <p className="mt-2 text-xs text-emerald-700">Email inviata a {inviataA}.</p>
      )}
      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}
    </section>
  );
}
