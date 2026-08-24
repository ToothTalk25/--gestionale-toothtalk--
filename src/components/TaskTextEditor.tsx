"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aggiornaTesti } from "@/app/actions";

export default function TaskTextEditor({
  taskId,
  campo,
  valore,
  disabilitato,
  placeholder,
}: {
  taskId: string;
  campo: "script" | "note_admin" | "titolo";
  valore: string | null;
  disabilitato: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [testo, setTesto] = useState(valore ?? "");
  const [esito, setEsito] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sporco = testo !== (valore ?? "");

  if (disabilitato) {
    return (
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
        {valore || <span className="text-slate-400">— vuoto —</span>}
      </p>
    );
  }

  return (
    <div className="mt-2">
      <textarea
        rows={campo === "note_admin" ? 4 : 10}
        value={testo}
        placeholder={placeholder}
        onChange={(e) => setTesto(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          disabled={!sporco || pending}
          onClick={() =>
            start(async () => {
              const r = await aggiornaTesti(taskId, { [campo]: testo } as Record<
                typeof campo,
                string
              >);
              setEsito(r.ok ? (r.dati.avvisi.length ? r.dati.avvisi.join(" · ") : "Salvato.") : r.errore);
              if (r.ok) router.refresh();
            })
          }
          className="tt-btn bg-tt-ink px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-40"
        >
          {pending ? "Salvo…" : "Salva"}
        </button>
        {esito && <span className="text-xs text-slate-500">{esito}</span>}
      </div>
    </div>
  );
}
