"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aggiornaTesti } from "@/app/actions";

/**
 * Campo per assegnare il numero del video al progetto.
 * Solo chi ha accesso globale lo vede e lo può modificare.
 * Salva al blur o premendo Invio.
 */
export default function NumeroVideoEditor({
  taskId,
  numeroVideo,
  isAdmin,
}: {
  taskId: string;
  numeroVideo: number | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [valore, setValore] = useState(numeroVideo?.toString() ?? "");
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);

  if (!isAdmin) return null;

  function salva() {
    const t = valore.trim();
    let n: number | null = null;
    if (t !== "") {
      n = parseInt(t, 10);
      if (isNaN(n) || n <= 0) {
        setErrore("Il numero video deve essere positivo.");
        return;
      }
    }
    start(async () => {
      setErrore(null);
      const esito = await aggiornaTesti(taskId, { numero_video: n });
      if (!esito.ok) setErrore(esito.errore);
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-xs text-slate-400">Video N·</label>
      <input
        type="number"
        value={valore}
        onChange={(e) => {
          setValore(e.target.value);
          setErrore(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") salva();
        }}
        onBlur={salva}
        className="w-16 rounded border border-slate-300 px-2 py-0.5 text-xs"
        min={1}
        disabled={pending}
      />
      {pending && <span className="text-xs text-slate-400">salvo…</span>}
      {errore && <span className="text-xs text-red-600">{errore}</span>}
    </div>
  );
}
