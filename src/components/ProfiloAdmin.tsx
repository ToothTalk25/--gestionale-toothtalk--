"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aggiornaAnagrafica } from "@/app/actions-profilo";
import type { Profile } from "@/lib/types";

/**
 * Profilo dell'Admin (Titolare). L'admin non compila un accordo né una
 * foto: gestisce il progetto dal Registro. Qui può solo aggiornare il
 * proprio recapito (email o PEC) — utile se cambia casella. È una vista
 * leggera e coerente con lo stile della pagina profilo dei partecipanti.
 */
export default function ProfiloAdmin({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [pec, setPec] = useState(profile.pec ?? "");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, start] = useTransition();

  function salva() {
    setErrore(null);
    setMessaggio(null);
    start(async () => {
      const esito = await aggiornaAnagrafica({ pec: pec.trim() || null });
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setMessaggio("Recapito aggiornato.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ------------------------------------------------ anagrafica */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">I miei dati</h2>
        <p className="mt-1 text-sm text-slate-500">{profile.email}</p>

        <label className="mt-5 block text-sm font-medium">Nome e cognome</label>
        <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {profile.full_name ?? "—"}
        </p>

        <label className="mt-4 block text-sm font-medium">
          Email o PEC di contatto
        </label>
        <input
          type="email"
          value={pec}
          onChange={(e) => setPec(e.target.value)}
          placeholder="nome@pec.it"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">
          Usata come recapito di cortesia. Per le comunicazioni ufficiali il
          sistema usa la PEC del progetto configurata lato server.
        </p>

        {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
        {messaggio && <p className="mt-3 text-sm text-emerald-700">{messaggio}</p>}

        <button
          onClick={salva}
          disabled={inCorso}
          className="mt-4 rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {inCorso ? "Salvo…" : "Salva"}
        </button>
      </section>

      {/* ------------------------------------------- strumenti admin */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Strumenti del Titolare</h2>
        <p className="mt-1 text-sm text-slate-500">
          Da qui raggiungi le aree di amministrazione del progetto.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>
            <a href="/admin" className="text-tt-blue hover:underline">
              → Registro globale (partecipanti, consensi, accordi, log)
            </a>
          </li>
          <li>
            <a href="/revisione" className="text-tt-blue hover:underline">
              → Video da rivedere
            </a>
          </li>
          <li>
            <a href="/dashboard" className="text-tt-blue hover:underline">
              → Progetti (vista globale)
            </a>
          </li>
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          Ruolo: <span className="font-medium text-slate-600">admin</span> ·
          accesso globale a tutti i gruppi.
        </p>
      </section>
    </div>
  );
}
