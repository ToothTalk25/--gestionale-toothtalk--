"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

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
    </form>
  );
}
