"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { impostaOnScreen } from "@/app/actions-profilo";

/**
 * Interruttore "In video / Dietro le quinte" per un partecipante, visibile
 * SOLO nella pagina admin (Registro). Serve a correggere il flag on_screen
 * dopo l'approvazione: chi appare nei video ha diritto di revoca GDPR (i
 * suoi video vanno purgati), chi non appare no. Solo l'admin può cambiarlo.
 */
export default function ToggleOnScreen({
  userId,
  appare,
}: {
  userId: string;
  appare: boolean;
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [valore, setValore] = useState(appare);

  async function cambia(nuovo: boolean) {
    setInCorso(true);
    setMessaggio(null);
    const esito = await impostaOnScreen(userId, nuovo);
    setInCorso(false);
    if (!esito.ok) {
      setMessaggio(esito.errore);
      return;
    }
    setValore(nuovo);
    router.refresh();
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      <button
        onClick={() => cambia(true)}
        disabled={inCorso || valore}
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-60 ${
          valore
            ? "bg-violet-600 text-white"
            : "bg-violet-50 text-violet-700 hover:bg-violet-100"
        }`}
        title="Appare nei video (ha diritto di revoca GDPR sui propri video)"
      >
        In video
      </button>
      <button
        onClick={() => cambia(false)}
        disabled={inCorso || !valore}
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition disabled:opacity-60 ${
          !valore
            ? "bg-slate-600 text-white"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
        title="Non appare nei video (dietro le quinte)"
      >
        Dietro le quinte
      </button>
      {messaggio && <span className="text-[11px] text-red-600">{messaggio}</span>}
    </span>
  );
}
