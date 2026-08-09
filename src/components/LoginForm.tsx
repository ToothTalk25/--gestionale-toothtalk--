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
      className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5"
    >
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
      <p className="mt-2 text-sm text-slate-500">Gestionale interno</p>

      <label className="mt-6 block text-sm font-medium">Email</label>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        autoComplete="email"
      />

      <label className="mt-4 block text-sm font-medium">Password</label>
      <input
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        autoComplete="current-password"
      />

      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}

      <button
        type="submit"
        disabled={inCorso}
        className="mt-6 w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {inCorso ? "Accesso…" : "Accedi"}
      </button>

      <p className="mt-4 text-xs text-slate-400">
        Gli account sono creati in anticipo. Se non riesci ad accedere, chiedi
        un reset della password.
      </p>

      <div className="mt-4 flex items-center justify-between text-xs">
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
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
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
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              autoComplete="email"
            />
            <button
              type="button"
              disabled={inCorso || !email}
              onClick={inviaReset}
              className="rounded-lg bg-tt-blue px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Invia
            </button>
          </div>
          {errore && <p className="text-xs text-red-600">{errore}</p>}
          {messaggio && <p className="text-xs text-emerald-600">{messaggio}</p>}
        </div>
      )}
    </form>
  );
}
