"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [mostraReset, setMostraReset] = useState(false);

  function resettaPassword() {
    setMostraReset((v) => !v);
    setErrore(null);
    setMessaggio(null);
  }

  async function inviaReset() {
    setInCorso(true);
    setErrore(null);
    setMessaggio(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/aggiorna-password`,
    });
    setInCorso(false);
    if (error) {
      setErrore("Impossibile inviare il reset: " + error.message);
    } else {
      setMessaggio("Controlla la tua email: ti abbiamo mandato un link per creare una nuova password.");
      setMostraReset(false);
    }
  }

  async function accedi(e: React.FormEvent) {
    e.preventDefault();
    setInCorso(true);
    setErrore(null);

    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrore("Credenziali non valide.");
      setInCorso(false);
      return;
    }
    router.replace(params.get("next") ?? "/dashboard");
    router.refresh();
  }

  return (
    <form
      onSubmit={accedi}
      className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 sm:max-w-sm sm:p-8"
    >
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-6 w-auto sm:h-9" />
      <p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Gestionale interno</p>

      <label className="mt-3 block text-xs font-medium sm:mt-6 sm:text-sm">Email</label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm"
        autoComplete="email"
      />

      <label className="mt-2 block text-xs font-medium sm:mt-4 sm:text-sm">Password</label>
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm"
        autoComplete="current-password"
      />

      {errore && <p className="mt-2 text-xs text-red-600 sm:mt-3 sm:text-sm">{errore}</p>}

      <button
        type="submit"
        disabled={inCorso}
        className="mt-3 w-full rounded-lg bg-tt-ink px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50 sm:mt-6 sm:py-2 sm:text-sm"
      >
        {inCorso ? "Accesso…" : "Accedi"}
      </button>

      <div className="mt-2.5 flex items-center justify-between text-[11px] sm:mt-4 sm:text-xs">
        <Link href="/registrati" className="text-tt-blue hover:underline">
          Registrati
        </Link>
        <button
          type="button"
          onClick={resettaPassword}
          disabled={inCorso}
          className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          {mostraReset ? "Annulla" : "Password dimenticata?"}
        </button>
      </div>

      {mostraReset && (
        <div className="mt-2.5 space-y-1.5 sm:mt-3 sm:space-y-2">
          <p className="text-[11px] text-slate-500 sm:text-xs">
            Inserisci la tua email: riceverai un link per creare una nuova
            password.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="La tua email"
              className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-xs"
              autoComplete="email"
            />
            <button
              type="button"
              disabled={inCorso || !email}
              onClick={inviaReset}
              className="rounded-lg bg-tt-blue px-3 py-1 text-[11px] font-medium text-white disabled:opacity-50 sm:py-1.5 sm:text-xs"
            >
              Invia
            </button>
          </div>
          {errore && <p className="text-[11px] text-red-600 sm:text-xs">{errore}</p>}
          {messaggio && <p className="text-[11px] text-emerald-600 sm:text-xs">{messaggio}</p>}
        </div>
      )}

      <p className="mt-2.5 text-center text-[11px] text-slate-400 sm:mt-4 sm:text-xs">
        <Link href="/privacy" className="hover:text-slate-600">
          Privacy e cookie policy
        </Link>
      </p>
    </form>
  );
}
