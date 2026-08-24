"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { terminaCollaborazione } from "@/app/actions-profilo";
import { useConferma } from "@/components/ConfermaAzione";

/**
 * "Termina Collaborazione" — visibile SOLO nel Registro partecipanti (pagina
 * admin). Disattiva solo l'account: NON tocca alcun file, per nessuno,
 * indipendentemente da on_screen. Uscire dal progetto e revocare il
 * consenso a immagine/voce sono due atti distinti — il secondo lo avvia il
 * Collaboratore stesso dal proprio profilo (sezione "Consensi e privacy"),
 * non l'admin da qui.
 */
export default function TerminaCollaborazione({
  userId,
  fullName,
  giaTerminata,
}: {
  userId: string;
  fullName: string | null;
  giaTerminata: boolean;
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const { chiedi, dialogo } = useConferma();

  async function termina() {
    const ok = await chiedi({
      titolo: `Terminare la collaborazione con ${fullName ?? "questo partecipante"}?`,
      descrizione:
        "Disattiva solo l'accesso: nessun file viene toccato, in nessun caso — anche se appare in video, i contenuti restano dove sono. La revoca del consenso a immagine/voce è un atto separato, che spetta a lui/lei dal proprio profilo.",
      peso: "grave",
      testoConferma: "Termina Collaborazione",
    });
    if (!ok) return;

    setInCorso(true);
    setMessaggio(null);
    const esito = await terminaCollaborazione(userId, true);
    setInCorso(false);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio("Collaborazione terminata.");
    router.refresh();
  }

  if (giaTerminata) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={termina}
        disabled={inCorso}
        className="tt-btn w-full border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
      >
        {inCorso ? "Termino…" : "Termina Collaborazione"}
      </button>
      {messaggio && <span className="text-xs text-slate-500">{messaggio}</span>}
      {dialogo}
    </div>
  );
}
