"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { riattivaCollaborazione } from "@/app/actions-profilo";

/** Pulsante per riattivare un account disattivato (solo accesso globale). */
export default function RiattivaCollaborazione({ userId }: { userId: string }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  async function riattiva() {
    const ok = window.confirm(
      "Riattivare questo account? L'accesso torna disponibile. I vecchi consensi " +
        "restano revocati: la persona li ridà da capo dal proprio profilo.",
    );
    if (!ok) return;
    setInCorso(true);
    setMessaggio(null);
    const esito = await riattivaCollaborazione(userId);
    setInCorso(false);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
    } else {
      setMessaggio("Account riattivato.");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={riattiva}
        disabled={inCorso}
        className="w-full rounded-md border border-emerald-200 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 sm:w-auto"
      >
        {inCorso ? "Riattivo…" : "Riattiva"}
      </button>
      {messaggio && <span className="text-xs text-slate-500">{messaggio}</span>}
    </div>
  );
}
