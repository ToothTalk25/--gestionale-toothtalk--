"use client";

import { useState } from "react";
import Link from "next/link";
import { registraConInvito, verificaCodice } from "@/app/actions-invito";

export default function RegistratiPage() {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [pec, setPec] = useState("");
  const [password, setPassword] = useState("");
  const [codice, setCodice] = useState("");
  const [onScreen, setOnScreen] = useState<boolean | null>(null);
  const [consenso, setConsenso] = useState(false);
  const [gruppo, setGruppo] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);

  // Appena il codice è scritto per intero, si mostra il gruppo: chi si
  // registra vede subito dove sta entrando, e un codice sbagliato si
  // scopre prima di compilare tutto il resto.
  async function controllaCodice(valore: string) {
    setGruppo(null);
    setErrore(null);
    if (valore.trim().length < 6) return;

    const esito = await verificaCodice(valore);
    if (esito.ok) setGruppo(esito.dati.gruppo);
    else setErrore(esito.errore);
  }

  async function registrati(e: React.FormEvent) {
    e.preventDefault();
    setInCorso(true);
    setErrore(null);

    const esito = await registraConInvito({
      nome,
      email,
      pec,
      password,
      codice,
      onScreen,
      consenso,
    });
    setInCorso(false);

    if (!esito.ok) {
      setErrore(esito.errore);
      return;
    }
    setFatto(esito.dati.gruppo);
  }

  if (fatto) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm tt-card p-8 text-center shadow-sm">
          <img
            src="/logo-toothtalk.svg"
            alt="ToothTalk"
            className="mx-auto h-9 w-auto"
          />
          <p className="mt-6 text-sm leading-relaxed">
            La tua richiesta di registrazione per il gruppo <strong>{fatto}</strong>{" "}
            è stata inviata.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Un amministratore la verificherà: appena approvata riceverai
            l&apos;accordo editoriale da firmare via PEC e potrai accedere.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white"
          >
            Vai al login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={registrati}
        className="w-full max-w-sm tt-card p-8 shadow-sm"
      >
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
        <p className="mt-2 text-sm text-slate-500">Nuovo account</p>

        <label className="mt-6 block text-sm font-medium">
          Codice del gruppo
        </label>
        <input
          required
          value={codice}
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            setCodice(v);
            void controllaCodice(v);
          }}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
          placeholder="MESSINA-4K7X"
          autoComplete="off"
        />
        {gruppo ? (
          <p className="mt-1 text-xs text-emerald-700">
            Entrerai nel gruppo <strong>{gruppo}</strong>
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            Te lo ha dato chi coordina il tuo gruppo.
          </p>
        )}

        <label className="mt-4 block text-sm font-medium">Nome e cognome</label>
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

        <label className="mt-4 block text-sm font-medium">Email o PEC (facoltativa)</label>
        <input
          type="email"
          value={pec}
          onChange={(e) => setPec(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="nome@pec.it"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-slate-400">
          Facoltativa: una PEC vera dà in più la certificazione di consegna
          delle comunicazioni, ma non è richiesta per partecipare.
        </p>

        <label className="mt-4 block text-sm font-medium">
          Apparirai nei video del progetto?
        </label>
        <p className="mt-1 text-xs text-slate-400">
          Serve per gestire la revoca del consenso (immagine/voce), non per
          scegliere un accordo: l&apos;accordo editoriale è uno per tutti.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOnScreen(true)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              onScreen === true
                ? "border-tt-blue bg-tt-blue-50 text-tt-blue"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            📹 Sì, in video
          </button>
          <button
            type="button"
            onClick={() => setOnScreen(false)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
              onScreen === false
                ? "border-tt-blue bg-tt-blue-50 text-tt-blue"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            🎨 No, dietro le quinte
          </button>
        </div>

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
        <p className="mt-1 text-xs text-slate-400">Almeno 8 caratteri.</p>

        {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}

        <label className="mt-5 flex items-start gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            required
            checked={consenso}
            onChange={(e) => setConsenso(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            Ho letto e accetto l&apos;{" "}
            <Link href="/privacy" className="text-tt-blue underline">
              informativa privacy
            </Link>{" "}
            e la{" "}
            <Link href="/privacy#cookie" className="text-tt-blue underline">
              cookie policy
            </Link>{" "}
            (GDPR).
          </span>
        </label>

        <button
          type="submit"
          disabled={inCorso || !gruppo}
          className="mt-6 w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {inCorso ? "Creazione…" : "Crea account"}
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
