"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eliminaAccount } from "@/app/actions-profilo";

/** Pulsante per eliminare un account dal Registro (solo accesso globale). */
export default function EliminaAccountAdmin({ userId }: { userId: string }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  async function elimina() {
    const ok = window.confirm(
      "Eliminare questo account? Verranno rimossi: foto, dati di contatto, consensi e il video grezzo (immagine/voce). L'accordo firmato (cessione di proprietà), script, copertina e l'archivio certificato PEC restano. Azione irreversibile.",
    );
    if (!ok) return;

    setInCorso(true);
    setMessaggio(null);
    const esito = await eliminaAccount(userId, true);
    setInCorso(false);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
    } else {
      setMessaggio("Account eliminato.");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={elimina}
        disabled={inCorso}
        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {inCorso ? "Elimino…" : "Elimina account"}
      </button>
      {messaggio && <span className="text-xs text-slate-500">{messaggio}</span>}
    </div>
  );
}
