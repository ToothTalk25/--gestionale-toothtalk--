"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notificaArt82, type RigaNotificaArt82 } from "@/app/actions-profilo";

/**
 * Coda dell'obbligo, previsto dall'Art. 8.2 dell'Accordo Editoriale, di
 * dare atto al Collaboratore — entro 30 giorni dalla revoca del consenso a
 * immagine/voce — dell'esistenza di eventuali contenuti già pubblicati che
 * lo ritraggono, informandolo della facoltà di chiederne la rimozione
 * (Art. 8.3). Creata SOLO quando la revoca non chiedeva già la rimozione:
 * in quel caso c'è la coda più forte "Richieste di rimozione" qui sopra.
 */
export default function NotificheDovuteArt82({
  notifiche,
  nomi,
}: {
  notifiche: RigaNotificaArt82[];
  nomi: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errore, setErrore] = useState<string | null>(null);

  const pendenti = notifiche.filter((n) => !n.notificata_at);
  const evase = notifiche.filter((n) => !!n.notificata_at);

  function notifica(id: string) {
    setErrore(null);
    start(async () => {
      const res = await notificaArt82(id);
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      router.refresh();
    });
  }

  if (pendenti.length === 0 && evase.length === 0) return null;

  return (
    <section className="tt-card p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Notifiche dovute (Art. 8.2 dell&apos;Accordo)</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Quando un Collaboratore revoca il consenso a immagine/voce senza
        chiedere anche la rimozione del pubblicato, l&apos;Accordo impone di
        dargliene comunque atto entro 30 giorni, informandolo della facoltà
        di chiederla in un secondo momento.
      </p>

      {pendenti.length > 0 && (
        <div className="mt-4 space-y-2">
          {pendenti.map((n) => {
            const scaduto = new Date(n.scade_at) < new Date();
            return (
              <div
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
              >
                <div>
                  <p className="font-medium text-amber-900">
                    {nomi[n.user_id] ?? n.user_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-amber-700">
                    Revocato il {new Date(n.revocato_at).toLocaleDateString("it-IT")} — termine{" "}
                    {scaduto ? "SCADUTO" : "entro"} il{" "}
                    {new Date(n.scade_at).toLocaleDateString("it-IT")}
                  </p>
                </div>
                <button
                  disabled={pending}
                  onClick={() => notifica(n.id)}
                  className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Notifica
                </button>
              </div>
            );
          })}
        </div>
      )}

      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}

      {evase.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">Già notificate</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {evase.map((n) => (
              <li key={n.id}>
                {nomi[n.user_id] ?? n.user_id.slice(0, 8)} — notificata il{" "}
                {new Date(n.notificata_at!).toLocaleDateString("it-IT")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
