"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eliminaAccount } from "@/app/actions-profilo";
import { useConferma } from "@/components/ConfermaAzione";

/** Pulsante per eliminare un account dal Registro (solo accesso globale). */
export default function EliminaAccountAdmin({ userId }: { userId: string }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const { chiedi, dialogo } = useConferma();

  async function elimina() {
    const ok = await chiedi({
      titolo: "Eliminare questo account?",
      descrizione: "L'operazione non si può annullare.",
      peso: "grave",
      testoConferma: "Elimina account",
      colonne: {
        perde: ["Foto e dati di contatto", "Consensi", "Video grezzo (immagine/voce)"],
        conserva: ["Accordo firmato (cessione di proprietà)", "Script e copertina", "Archivio certificato PEC"],
      },
    });
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
        className="tt-btn w-full border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 sm:w-auto"
      >
        {inCorso ? "Elimino…" : "Elimina account"}
      </button>
      {messaggio && <span className="text-xs text-slate-500">{messaggio}</span>}
      {dialogo}
    </div>
  );
}
