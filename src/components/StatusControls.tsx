"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiaStato, impostaBlocco } from "@/app/actions";
import { STATI_MEMBRO, STATUS_LABEL, type TaskStatus } from "@/lib/types";

// "sigillato" non è tra le scelte manuali: è sempre derivato dalle RPC
// sigilla_pacchetto/rimanda_in_composizione/annulla_pacchetto. Impostarlo
// da qui creerebbe un badge "sigillato" senza un sigillo vero dietro
// (nessun manifesto, nessuna PEC) — la stessa classe di bug corretta
// nell'audit UX di questa sessione, nel caso peggiore possibile.
const STATI_ADMIN: TaskStatus[] = [
  "da_fare",
  "consegnato",
  "in_revisione",
  "modificato_admin",
  "pubblicato",
];

export default function StatusControls({
  taskId,
  status,
  locked,
  isAdmin,
}: {
  taskId: string;
  status: TaskStatus;
  locked: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const disponibili = isAdmin ? STATI_ADMIN : STATI_MEMBRO;
  const disabilitato = pending || (!isAdmin && locked);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {disponibili.map((s) => (
        <button
          key={s}
          disabled={disabilitato || s === status}
          onClick={() =>
            start(async () => {
              setErrore(null);
              const esito = await cambiaStato(taskId, s);
              if (!esito.ok) setErrore(esito.errore);
              else router.refresh();
            })
          }
          className={`rounded-full border px-3 py-1 text-xs ${
            s === status
              ? "border-tt-ink bg-tt-ink text-white"
              : "border-slate-300 hover:bg-slate-50"
          } disabled:opacity-40`}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}

      {isAdmin && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErrore(null);
              const esito = await impostaBlocco(taskId, !locked);
              if (!esito.ok) setErrore(esito.errore);
              else router.refresh();
            })
          }
          className="ml-2 rounded-full border border-amber-400 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50"
        >
          {locked ? "Sblocca progetto" : "Blocca contenuti"}
        </button>
      )}

      {errore && <p className="w-full text-xs text-red-600">{errore}</p>}
    </div>
  );
}
