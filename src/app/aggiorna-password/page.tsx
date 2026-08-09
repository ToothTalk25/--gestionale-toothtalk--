"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Callback del reset password: l'utente arriva qui dal link ricevuto via email.
 * Supabase scrive il token nell'URL, il client lo scambia in automatico con
 * una sessione temporanea che permette di chiamare updateUser per impostare
 * la nuova password.
 */
export default function AggiornaPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    // Quando atterra qui, l'URL contiene il token nel fragment (#).
    // Supabase JS lo scambia automaticamente: basta aspettare che il
    // listener session lo rilevi.
    const supabase = supabaseBrowser();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setPronto(true);
      }
    });
    // Se il token è già stato processato prima che il listener si registri
    // (es. la pagina era già aperta), proviamo a leggere la sessione subito.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPronto(true);
    });
  }, []);

  async function aggiorna(e: React.FormEvent) {
    e.preventDefault();
    setInCorso(true);
    setErrore(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });
    setInCorso(false);
    if (error) {
      setErrore(error.message);
    } else {
      setMessaggio("Password aggiornata! Tra qualche secondo tornerai alla dashboard.");
      setTimeout(() => router.replace("/dashboard"), 2500);
    }
  }

  if (!pronto) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-slate-500">Verifica del link in corso…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={aggiorna}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5"
      >
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
        <p className="mt-2 text-sm text-slate-500">Nuova password</p>

        <label className="mt-6 block text-sm font-medium">Password</label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          autoComplete="new-password"
          placeholder="Almeno 8 caratteri"
        />

        {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
        {messaggio && <p className="mt-3 text-sm text-emerald-600">{messaggio}</p>}

        <button
          type="submit"
          disabled={inCorso || password.length < 8}
          className="mt-6 w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {inCorso ? "Salvo…" : "Aggiorna password"}
        </button>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link href="/login" className="text-tt-blue hover:underline">
            Torna al login
          </Link>
        </p>
      </form>
    </main>
  );
}
