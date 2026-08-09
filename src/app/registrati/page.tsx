"use client";

import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function RegistratiPage() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  async function registrati(e: React.FormEvent) {
    e.preventDefault();
    setInCorso(true);
    setErrore(null);
    setMessaggio(null);

    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: nome },
      },
    });

    setInCorso(false);
    if (error) {
      setErrore(error.message);
    } else {
      setMessaggio(
        "Registrazione completata! Se ti abbiamo chiesto di confermare l'email, " +
          "controlla la tua casella e clicca il link. Poi torna qui per accedere.",
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={registrati}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5"
      >
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
        <p className="mt-2 text-sm text-slate-500">Nuovo account</p>

        <label className="mt-6 block text-sm font-medium">Nome e cognome</label>
        <input
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          autoComplete="name"
          placeholder="Mario Rossi"
        />

        <label className="mt-4 block text-sm font-medium">Email</label>
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
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          autoComplete="new-password"
        />

        {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
        {messaggio && <p className="mt-3 text-sm text-emerald-600">{messaggio}</p>}

        <button
          type="submit"
          disabled={inCorso}
          className="mt-6 w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {inCorso ? "Registrazione…" : "Crea account"}
        </button>

        <p className="mt-4 text-center text-xs text-slate-400">
          Hai già un account?{" "}
          <Link href="/login" className="text-tt-blue hover:underline">
            Accedi
          </Link>
        </p>
      </form>
    </main>
  );
}
