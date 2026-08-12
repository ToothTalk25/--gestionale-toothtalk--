"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { archiviaPacchettoCompleto } from "@/app/actions";

export default function BottoneArchiviaTutto({
  taskId,
  pacchettoId,
}: {
  taskId: string;
  pacchettoId: string;
}) {
  const router = useRouter();
  const [conferma, setConferma] = useState(false);
  const [pending, setPending] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  async function esegui() {
    setPending(true);
    setErrore(null);
    const res = await archiviaPacchettoCompleto(taskId, pacchettoId);
    if (!res.ok) {
      setErrore(res.errore);
      setConferma(false);
    } else {
      router.refresh();
    }
    setPending(false);
  }

  return (
    <div>
      {conferma ? (
        <div className="flex items-center gap-2">
          {errore && <span className="text-xs text-red-600">{errore}</span>}
          <span className="text-xs text-slate-500">Confermi?</span>
          <button
            onClick={esegui}
            disabled={pending}
            className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Sì
          </button>
          <button
            onClick={() => { setConferma(false); setErrore(null); }}
            className="text-xs text-slate-500 hover:underline"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConferma(true)}
          className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
        >
          Archivia tutto
        </button>
      )}
    </div>
  );
}
