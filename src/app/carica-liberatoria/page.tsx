"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { caricaLiberatoriaPubblica } from "@/app/actions-liberatoria";

export default function CaricaLiberatoriaPage() {
  const params = useSearchParams();
  const token = params.get("token");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <p className="text-sm text-slate-600">Token mancante.</p>
      </div>
    );
  }

  if (ok) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <p className="text-lg font-medium text-emerald-700">Liberatoria caricata ✓</p>
        <p className="mt-2 text-sm text-slate-600">
          Il file è stato ricevuto. Puoi chiudere questa pagina.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <img
        src="/logo-toothtalk.svg"
        alt="ToothTalk"
        className="mx-auto h-9 w-auto"
      />
      <p className="mt-4 text-center text-sm text-slate-600">
        Carica la liberatoria firmata (PDF o immagine). Il file arriva
        direttamente a chi gestisce il progetto e non è visibile a nessun
        altro.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            setErrore(null);
            const esito = await caricaLiberatoriaPubblica(token, fd);
            if (!esito.ok) {
              setErrore(esito.errore);
            } else {
              setOk(true);
            }
          });
        }}
        className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6"
      >
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File firmato (PDF o immagine)
          </label>
          <input
            type="file"
            name="file"
            accept="application/pdf,image/*"
            required
            className="mt-1 block w-full text-sm text-slate-500
              file:mr-4 file:rounded-lg file:border-0 file:bg-tt-blue
              file:px-4 file:py-2 file:text-xs file:font-medium
              file:text-white hover:file:bg-tt-ink"
          />
        </div>

        {errore && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errore}</p>
        )}
        {messaggio && (
          <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{messaggio}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Carico…" : "Carica liberatoria"}
        </button>
      </form>
    </div>
  );
}

