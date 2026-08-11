"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { firmaLiberatoriaOnline } from "@/app/actions-liberatoria";

export default function CaricaLiberatoriaPage() {
  const params = useSearchParams();
  const token = params.get("token");
  const [nome, setNome] = useState("");
  const [consenso, setConsenso] = useState(false);
  const [firma, setFirma] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <p className="text-sm text-slate-600">Link non valido.</p>
      </div>
    );
  }

  if (ok) {
    return (
      <div className="mx-auto max-w-sm px-4 py-20 text-center">
        <p className="text-lg font-medium text-emerald-700">Liberatoria firmata ✓</p>
        <p className="mt-2 text-sm text-slate-600">
          Grazie. Il documento è stato ricevuto. Puoi chiudere questa pagina.
        </p>
      </div>
    );
  }

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { setErrore("Inserisci nome e cognome."); return; }
    if (!consenso) { setErrore("Devi acconsentire al trattamento."); return; }
    start(async () => {
      setErrore(null);
      const esito = await firmaLiberatoriaOnline(token, nome.trim(), firma.trim() || nome.trim());
      if (!esito.ok) setErrore(esito.errore);
      else setOk(true);
    });
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-20">
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="mx-auto h-9 w-auto" />
      <p className="mt-4 text-center text-sm text-slate-600">
        Compila i dati e firma. Il documento viene generato e archiviato
        automaticamente: non devi scaricare né caricare nulla.
      </p>

      <form onSubmit={invia} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Nome e cognome
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Il tuo nome e cognome"
          />
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={consenso}
            onChange={(e) => setConsenso(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="text-slate-600">
            Acconsento al trattamento della mia immagine e voce nel video
            del progetto ToothTalk, come da informativa privacy.
          </span>
        </label>

        <div>
          <label className="block text-sm font-medium text-slate-700">
            Firma (scrivi il tuo nome)
          </label>
          <input
            type="text"
            value={firma}
            onChange={(e) => setFirma(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm italic"
            placeholder={nome || "Firma"}
          />
          <p className="mt-1 text-xs text-slate-400">
            Scrivendo il tuo nome dichiari di firmare il documento.
          </p>
        </div>

        {errore && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errore}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Invio…" : "Firma e invia"}
        </button>
      </form>
    </div>
  );
}


