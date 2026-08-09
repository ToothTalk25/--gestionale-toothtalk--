"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { creaTask } from "@/app/actions";

export default function NewTaskForm({ poloId }: { poloId: string }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!aperto) {
    return (
      <button
        onClick={() => setAperto(true)}
        className="rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white"
      >
        + Nuovo progetto
      </button>
    );
  }

  return (
    <form
      action={(fd) =>
        start(async () => {
          const esito = await creaTask(fd);
          if (!esito.ok) {
            setErrore(esito.errore);
            return;
          }
          setAperto(false);
          router.push(`/task/${esito.dati.id}`);
        })
      }
      className="space-y-3 rounded-xl bg-white p-5 ring-1 ring-black/5"
    >
      <input type="hidden" name="polo_id" value={poloId} />

      <div>
        <label className="block text-sm font-medium">Titolo del video</label>
        <input
          name="titolo"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Es. Perché i denti del giudizio si tolgono?"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Script (bozza)</label>
        <textarea
          name="script"
          rows={5}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Scadenza</label>
        <input
          type="date"
          name="scadenza"
          className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      {errore && <p className="text-sm text-red-600">{errore}</p>}

      <div className="flex gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Creo…" : "Crea progetto"}
        </button>
        <button
          type="button"
          onClick={() => setAperto(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
        >
          Annulla
        </button>
      </div>
    </form>
  );
}
