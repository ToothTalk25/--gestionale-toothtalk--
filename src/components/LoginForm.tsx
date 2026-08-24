"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { percorsoInternoValido } from "@/lib/percorsi";

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
    // Il parametro "next" viene usato solo se è un percorso INTERNO:
    // altrimenti (es. next=https://maligno.com, //evil.com) si va sulla
    // dashboard. È la difesa contro l'open redirect dopo il login.
    const next = params.get("next");
    router.replace(percorsoInternoValido(next) ? next! : "/dashboard");
    router.refresh();
  }

  return (
    <form
      onSubmit={accedi}
      className="flex min-h-screen w-full flex-col px-6 py-8 sm:min-h-0 sm:max-w-sm sm:rounded-2xl sm:bg-white sm:p-8 sm:px-8 sm:py-8 sm:shadow-sm sm:ring-1 sm:ring-black/5"
    >
      {/* Blocco logo+campi+registrati centrato nello spazio disponibile,
          con le stesse proporzioni interne di prima; solo Privacy resta
          sempre in fondo (è fuori da questo contenitore che cresce). */}
      <div className="flex flex-1 flex-col justify-center sm:flex-none">
      {/* Solo il logo (con la scritta sotto) nudgiato un filo più in alto,
          il resto del blocco resta dov'era. */}
      {/* Su telefono logo e sottotitolo restano centrati: da soli in cima allo
          schermo, allineati a sinistra sembrano appoggiati al bordo. Da sm in
          su la card ha una sua cornice e l'allineamento a sinistra funziona. */}
      <div className="-mt-10 flex flex-col items-center text-center sm:mt-0 sm:items-start sm:text-left">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-10 w-auto sm:h-9" />
        <p className="mt-2 text-sm text-slate-500">Gestionale interno</p>
      </div>

      {/* Campi, subito sotto il logo. */}
      <div className="mt-8 sm:mt-6">
        <label className="block text-sm font-medium">Email</label>
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
          className="tt-btn mt-6 w-full bg-tt-ink px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
        >
          {inCorso ? "Accesso…" : "Accedi"}
        </button>
      </div>

      {/* Registrati / Password dimenticata, subito sotto il bottone. */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
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
                className="tt-btn bg-tt-blue px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
              >
                Invia
              </button>
            </div>
            {errore && <p className="text-xs text-red-600">{errore}</p>}
            {messaggio && <p className="text-xs text-emerald-600">{messaggio}</p>}
          </div>
        )}
      </div>
      </div>

      {/* Privacy e cookie: resta in fondo, fuori dal blocco centrato sopra. */}
      <p className="text-center text-xs text-slate-400 sm:mt-4">
        <Link href="/privacy" className="hover:text-slate-600">
          Privacy e cookie policy
        </Link>{" "}
        ·{" "}
        <Link href="/termini" className="hover:text-slate-600">
          Termini di servizio
        </Link>
      </p>
    </form>
  );
}
