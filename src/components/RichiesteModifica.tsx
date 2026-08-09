"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apriRichiesta, chiudiRichiesta } from "@/app/actions-revisione";
import {
  AMBITO_LABEL,
  type AmbitoRichiesta,
  type RichiestaModifica,
} from "@/lib/types";

const AMBITI: AmbitoRichiesta[] = [
  "video",
  "copertina",
  "descrizione",
  "script",
  "generale",
];

export default function RichiesteModifica({
  taskId,
  pacchettoId,
  richieste,
  nomi,
  isAdmin,
  compatta = false,
}: {
  taskId: string;
  pacchettoId: string | null;
  richieste: RichiestaModifica[];
  nomi: Record<string, string>;
  isAdmin: boolean;
  compatta?: boolean;
}) {
  const router = useRouter();
  const [ambito, setAmbito] = useState<AmbitoRichiesta>("generale");
  const [testo, setTesto] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const aperte = richieste.filter((r) => r.stato === "aperta");
  const risolte = richieste.filter((r) => r.stato === "risolta");

  return (
    <div className={compatta ? "" : "rounded-2xl bg-white p-6 ring-1 ring-black/5"}>
      {!compatta && (
        <>
          <h2 className="text-lg font-medium">Modifiche richieste</h2>
          <p className="mt-1 text-sm text-slate-500">
            Le correzioni da fare su questo video. Non modificano il pacchetto
            già sigillato: se servono cambiamenti sostanziali, quello va
            annullato e ricomposto.
          </p>
        </>
      )}

      {aperte.length === 0 && risolte.length === 0 && (
        <p className={compatta ? "text-xs text-slate-400" : "mt-3 text-sm text-slate-400"}>
          Nessuna modifica richiesta.
        </p>
      )}

      {aperte.length > 0 && (
        <ul className="mt-3 space-y-2">
          {aperte.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border-l-4 border-amber-400 bg-amber-50 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                  {AMBITO_LABEL[r.ambito]}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(r.creata_at).toLocaleString("it-IT")}
                  {r.creata_da ? ` · ${nomi[r.creata_da] ?? ""}` : ""}
                </span>
                <button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const esito = await chiudiRichiesta(taskId, r.id);
                      if (!esito.ok) setErrore(esito.errore);
                      else router.refresh();
                    })
                  }
                  className="ml-auto text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                >
                  Segna come fatta
                </button>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{r.testo}</p>
            </li>
          ))}
        </ul>
      )}

      {risolte.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            {risolte.length} già risolte
          </summary>
          <ul className="mt-2 space-y-1.5">
            {risolte.map((r) => (
              <li key={r.id} className="rounded-lg bg-slate-50 p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium">{AMBITO_LABEL[r.ambito]}</span>
                  <span>
                    risolta il{" "}
                    {r.risolta_at
                      ? new Date(r.risolta_at).toLocaleString("it-IT")
                      : "—"}
                    {r.risolta_da ? ` da ${nomi[r.risolta_da] ?? ""}` : ""}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {r.testo}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {isAdmin && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={ambito}
              onChange={(e) => setAmbito(e.target.value as AmbitoRichiesta)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              {AMBITI.map((a) => (
                <option key={a} value={a}>
                  {AMBITO_LABEL[a]}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">
              cosa va corretto in questo video
            </span>
          </div>

          <textarea
            rows={3}
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            placeholder="Es. la copertina è sfocata, rifarla con il testo più grande…"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <button
            disabled={pending || !testo.trim()}
            onClick={() =>
              start(async () => {
                setErrore(null);
                const esito = await apriRichiesta(
                  taskId,
                  pacchettoId,
                  ambito,
                  testo,
                );
                if (!esito.ok) setErrore(esito.errore);
                else {
                  setTesto("");
                  router.refresh();
                }
              })
            }
            className="mt-2 rounded-lg bg-tt-ink px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            {pending ? "Invio…" : "Richiedi modifica"}
          </button>
        </div>
      )}

      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}
    </div>
  );
}
