"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { riepilogoTaskOnScreen, terminaCollaborazione } from "@/app/actions-profilo";
import { STATUS_LABEL, type TaskStatus } from "@/lib/types";
import type { TaskRiepilogoRevoca } from "@/app/actions-profilo";

/**
 * "Termina Collaborazione" — visibile SOLO nel Registro partecipanti (pagina
 * admin). Nessuna sezione dedicata: il flusso resta nascosto nella gestione
 * del profilo, come richiesto.
 *
 * - partecipante on-screen: mostra un riepilogo delle task collegate e chiede
 *   una conferma esplicita prima di purgare i video/audio dallo storage.
 * - partecipante backstage: conferma semplice, nessun file toccato.
 */
export default function TerminaCollaborazione({
  userId,
  fullName,
  onScreen,
  giaTerminata,
}: {
  userId: string;
  fullName: string | null;
  onScreen: boolean;
  giaTerminata: boolean;
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [caricoRiepilogo, setCaricoRiepilogo] = useState(false);

  async function caricaRiepilogo(): Promise<TaskRiepilogoRevoca[] | null> {
    if (!onScreen) return null; // backstage: nessun riepilogo, conferma semplice
    setCaricoRiepilogo(true);
    setMessaggio(null);
    const esito = await riepilogoTaskOnScreen(userId);
    setCaricoRiepilogo(false);
    if (!esito.ok) {
      setMessaggio(esito.errore);
      return null;
    }
    return esito.dati.task;
  }

  async function termina(righe: TaskRiepilogoRevoca[] | null) {
    // Conoscendo il riepilogo, chiedi conferma esplicita del purge.
    if (onScreen) {
      const totale = righe?.reduce((n, t) => n + t.versioni, 0) ?? 0;
      const ok = window.confirm(
        `TERMINARE LA COLLABORAZIONE con ${fullName ?? "questo partecipante"}?\n\n` +
          `Questo partecipante appare in video (on-screen). Verranno ELIMINATI DEFINITIVAMENTE ` +
          (totale > 0
            ? `${totale} file video/audio dallo storage.\n`
            : `i file video/audio che lo ritraggono (nessuno al momento).\n`) +
          (righe && righe.length > 0
            ? `\nTask archiviate (${righe.length}):\n` +
              righe
                .map(
                  (t) =>
                    `  • ${t.titolo} (${STATUS_LABEL[t.status as TaskStatus] ?? t.status})`,
                )
                .join("\n") +
              "\n"
            : "") +
          `\nIl lavoro di backstage (script, copertine, descrizioni) e l'accordo firmato RESTANO. ` +
          `L'account verrà disattivato. Azione IRREVERSIBILE.\n\nConfermi?`,
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        `Terminare la collaborazione con ${fullName ?? "questo partecipante"}?\n` +
          `Nessun file verrà toccato (partecipante di backstage): si disattiva solo l'accesso.`,
      );
      if (!ok) return;
    }

    setInCorso(true);
    setMessaggio(null);
    const esito = await terminaCollaborazione(userId, true);
    setInCorso(false);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      esito.dati.on_screen
        ? `Collaborazione terminata. ${esito.dati.versioni_purgate} file purgati, ${esito.dati.task} task archiviate.`
        : "Collaborazione terminata (nessun file toccato).",
    );
    router.refresh();
  }

  if (giaTerminata) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={async () => {
          const righe = await caricaRiepilogo();
          await termina(righe);
        }}
        disabled={inCorso || caricoRiepilogo}
        className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
      >
        {inCorso
          ? "Termino…"
          : caricoRiepilogo
            ? "Controllo…"
            : onScreen
              ? "Termina Collaborazione (on-screen)"
              : "Termina Collaborazione"}
      </button>
      {messaggio && <span className="text-xs text-slate-500">{messaggio}</span>}
    </div>
  );
}
