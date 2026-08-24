"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { creaTask } from "@/app/actions";
import type { Formato } from "@/lib/types";

export default function NewTaskForm({
  poloId,
  formati,
}: {
  poloId: string;
  formati: Formato[];
}) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [formatoId, setFormatoId] = useState("");
  const [pending, start] = useTransition();

  const formato = formati.find((f) => f.id === formatoId);

  if (!aperto) {
    return (
      <button
        onClick={() => setAperto(true)}
        className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white hover:brightness-95"
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
          if (esito.dati.avvisi.length) {
            router.push(
              `/task/${esito.dati.id}?avviso=${encodeURIComponent(esito.dati.avvisi.join(" · "))}`,
            );
          } else {
            router.push(`/task/${esito.dati.id}`);
          }
        })
      }
      className="space-y-3 tt-card-piccola p-5"
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
        <label className="block text-sm font-medium">Formato del contenuto</label>
        <select
          name="formato_id"
          required
          value={formatoId}
          onChange={(e) => setFormatoId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Scegli un formato…</option>
          {formati.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">Script (bozza)</label>
        <textarea
          name="script"
          rows={5}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {formato?.istruzioni_script ? (
          <p className="mt-1 text-xs text-slate-500">{formato.istruzioni_script}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            Scegli il formato per sapere cosa scrivere qui.
          </p>
        )}
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
          className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
        >
          {pending ? "Creo…" : "Crea progetto"}
        </button>
        <button
          type="button"
          onClick={() => setAperto(false)}
          className="tt-btn border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Annulla
        </button>
      </div>
    </form>
  );
}
