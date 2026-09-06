"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eliminaAccount } from "@/app/actions-profilo";
import { useConferma } from "@/components/ConfermaAzione";

/**
 * Pulsante per eliminare un account dal Registro (solo accesso globale).
 *
 * `contesto="registrazione"`: usato per una richiesta mai approvata (vedi
 * RichiesteRegistrazione.tsx) — a quello stadio non esiste ancora nessun
 * accordo, materiale o certificazione, quindi il testo di conferma è diverso
 * (niente colonne "perde/conserva" fuorvianti). Il comportamento REALE lo
 * decide comunque il server in base allo stato vero del profilo
 * (eliminaAccount, actions-profilo.ts): questa prop cambia solo cosa si
 * legge prima di confermare, non cosa succede dopo.
 */
export default function EliminaAccountAdmin({
  userId,
  contesto,
}: {
  userId: string;
  contesto?: "registrazione";
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const { chiedi, dialogo } = useConferma();

  const registrazione = contesto === "registrazione";

  async function elimina() {
    const ok = registrazione
      ? await chiedi({
          titolo: "Respingere questa richiesta?",
          descrizione:
            "Nessun accordo, materiale o certificazione è ancora mai stato creato per questa richiesta: verrà eliminata completamente, senza lasciare traccia nel Registro.",
          peso: "grave",
          testoConferma: "Respingi richiesta",
        })
      : await chiedi({
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
      setMessaggio(registrazione ? "Richiesta eliminata." : "Account eliminato.");
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
        {inCorso
          ? registrazione
            ? "Respingo…"
            : "Elimino…"
          : registrazione
            ? "Respingi richiesta"
            : "Elimina account"}
      </button>
      {messaggio && <span className="text-xs text-slate-500">{messaggio}</span>}
      {dialogo}
    </div>
  );
}
