"use client";

import { useState, useTransition, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { richiediOtpLiberatoria, firmaConOtpLiberatoria } from "@/app/actions-liberatoria";

export default function CaricaLiberatoriaPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-sm px-4 py-20 text-center"><p className="text-sm text-slate-600">Caricamento…</p></div>}>
      <CaricaLiberatoriaForm />
    </Suspense>
  );
}

function CaricaLiberatoriaForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [nome, setNome] = useState("");
  const [consenso, setConsenso] = useState(false);
  const [step, setStep] = useState<"nome" | "otp">("nome");
  const [otp, setOtp] = useState("");
  const [isPending, startTransition] = useTransition();
  const [messaggio, setMessaggio] = useState<{ tipo: "ok" | "errore"; testo: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="mx-auto h-8 w-auto" />
        <div className="mt-6 tt-card border border-red-200 p-6 text-center">
          <h2 className="text-lg font-semibold text-red-800">Link non valido</h2>
          <p className="mt-1 text-sm text-red-600">Token mancante o scaduto. Chiedi un nuovo link.</p>
        </div>
      </div>
    );
  }

  function richiediOtp() {
    if (!nome.trim()) return setMessaggio({ tipo: "errore", testo: "Inserisci il nome." });
    if (!consenso) return setMessaggio({ tipo: "errore", testo: "Devi accettare il consenso." });
    startTransition(async () => {
      const res = await richiediOtpLiberatoria(token, nome.trim());
      if ("errore" in res) {
        setMessaggio({ tipo: "errore", testo: res.errore });
      } else {
        setMessaggio({ tipo: "ok", testo: "Codice inviato alla tua email (controlla anche lo spam)." });
        setStep("otp");
      }
    });
  }

  function firma() {
    if (!otp.trim()) return setMessaggio({ tipo: "errore", testo: "Inserisci il codice." });
    startTransition(async () => {
      const res = await firmaConOtpLiberatoria(token, nome.trim(), otp.trim());
      if ("errore" in res) {
        setMessaggio({ tipo: "errore", testo: res.errore });
      } else {
        setMessaggio({ tipo: "ok", testo: "Liberatoria firmata! ✅" });
      }
    });
  }

  const fatto = messaggio?.tipo === "ok" && messaggio.testo.includes("firmata");
  if (fatto) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="mx-auto h-8 w-auto" />
        <div className="mt-6 tt-card border border-emerald-200 p-8 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-semibold text-emerald-800">Fatto!</h2>
          <p className="mt-2 text-sm text-emerald-700">{messaggio!.testo}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-10">
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-8 w-auto" />
      <form ref={formRef} onSubmit={e => e.preventDefault()} className="mt-6 tt-card p-6">
        <h1 className="text-xl font-semibold text-tt-ink">Liberatoria Privacy</h1>
        <p className="mt-2 text-sm text-slate-500">
          Firma digitale tramite codice monouso. Riceverai un codice di 6 cifre alla tua email.
        </p>

        {messaggio && (
          <div className={`mt-4 rounded-lg border p-3 text-sm ${
            messaggio.tipo === "errore" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {messaggio.testo}
          </div>
        )}

        <div className={`mt-6 space-y-4 ${step === "otp" ? "pointer-events-none opacity-60" : ""}`}>
          <label className="block">
            <span className="text-sm font-medium text-tt-ink">Nome e Cognome</span>
            <input
              type="text"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-tt-blue focus:ring-1 focus:ring-tt-blue"
              placeholder="Mario Rossi"
              value={nome}
              onChange={e => setNome(e.target.value)}
              disabled={isPending || step === "otp"}
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-tt-blue focus:ring-tt-blue"
              checked={consenso}
              onChange={e => setConsenso(e.target.checked)}
              disabled={isPending || step === "otp"}
            />
            <span className="text-xs text-slate-500 leading-relaxed">
              Acconsento al trattamento dei miei dati personali e alla pubblicazione della mia immagine/voce
              per le finalita&apos; del progetto ToothTalk, come da{" "}
              <a href="/privacy" target="_blank" className="text-tt-blue underline">informativa privacy</a>.
            </span>
          </label>
          <button
            type="button"
            onClick={richiediOtp}
            disabled={isPending || step === "otp"}
            className="tt-btn w-full bg-tt-blue px-4 py-2.5 text-sm text-white hover:brightness-95 disabled:opacity-50"
          >
            {isPending ? "Invio codice…" : "Invia codice di verifica"}
          </button>
        </div>
        {step === "otp" && (
          <div className="mt-6 space-y-4 border-t border-slate-100 pt-6">
            <p className="text-sm font-medium text-tt-ink">Inserisci il codice di 6 cifre ricevuto via email</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="block w-full rounded-lg border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.5em] font-mono focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              placeholder="000000"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={isPending}
              autoFocus
            />
            <button
              type="button"
              onClick={firma}
              disabled={isPending || otp.length !== 6}
              className="tt-btn w-full bg-emerald-600 px-4 py-2.5 text-sm text-white hover:brightness-95 disabled:opacity-50"
            >
              {isPending ? "Verifica…" : "Firma ✍️"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("nome"); setOtp(""); setMessaggio(null); }}
              disabled={isPending}
              className="w-full text-xs text-slate-500 underline hover:text-slate-700"
            >
              ← Non hai ricevuto il codice? Torna indietro e riprova
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

