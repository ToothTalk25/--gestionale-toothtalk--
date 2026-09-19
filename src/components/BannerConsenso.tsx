"use client";

import { useState } from "react";
import Link from "next/link";
import { registraConsenso } from "@/app/actions-profilo";

/**
 * Banner di presa visione GDPR: informativa privacy e cookie policy.
 *
 * CHI LO VEDE LO DECIDE IL SERVER (src/app/(app)/layout.tsx), che è l'unico a
 * poter leggere la sessione: i cookie di autenticazione sono HttpOnly, quindi
 * dal browser supabaseBrowser() non vede la sessione e questo componente si
 * nasconderebbe da solo. Fino al 19/09/2026 funzionava proprio così — il banner
 * non compariva mai, e i consensi in tabella arrivavano solo dai flussi
 * automatici di invito (che li registrano senza che nessuno li abbia visti).
 *
 * Serve a due cose insieme: la prima presa visione, e — alzando
 * PRIVACY_VERSION (src/lib/types.ts) — l'avviso a chi c'era già quando
 * l'informativa cambia. Nel secondo caso lo dice con le parole giuste
 * («aggiornata»), invece di far finta che sia la prima volta. In entrambi i
 * casi la presa visione resta registrata (tabella `consensi` + ricevuta
 * firmata su storage).
 */
export default function BannerConsenso({
  mancanti,
  aggiornamento,
}: {
  mancanti: { privacy: boolean; cookie: boolean };
  aggiornamento: boolean;
}) {
  const [nascosto, setNascosto] = useState(false);
  const [erroreUi, setErroreUi] = useState<string | null>(null);

  if (nascosto || (!mancanti.privacy && !mancanti.cookie)) return null;

  // Un solo pulsante, nessuna scelta da offrire: il gestionale usa solo cookie
  // tecnici, quindi non esiste un "tutto / solo necessari" da proporre. Il
  // banner chiude SOLO se ciò che mancava è stato registrato davvero —
  // altrimenti ricompare al prossimo giro, invece di sparire senza prova.
  async function accetta() {
    setErroreUi(null);
    let tuttoOk = true;
    // Si registra solo ciò che manca: chi aveva già preso visione della cookie
    // policy (invariata) non se la vede riscrivere una seconda volta nel
    // registro, che resta leggibile come prova.
    const daRegistrare: Array<"privacy" | "cookie"> = [];
    if (mancanti.privacy) daRegistrare.push("privacy");
    if (mancanti.cookie) daRegistrare.push("cookie");

    for (const tipo of daRegistrare) {
      try {
        const r = await registraConsenso(tipo);
        if (!r.ok) {
          setErroreUi((e) => (e ? e + " · " : "") + r.errore);
          tuttoOk = false;
        }
      } catch (e) {
        // La server action ha lanciato: il consenso potrebbe non essere stato
        // registrato. Non chiudiamo il banner, mostriamo l'errore.
        setErroreUi("Errore durante il salvataggio: " + (e instanceof Error ? e.message : String(e)));
        tuttoOk = false;
      }
    }
    // Chiudi SOLO se tutto ciò che serviva è stato davvero registrato:
    // un'accettazione non salvata non è un'accettazione.
    if (tuttoOk) setNascosto(true);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="flex-1 text-xs leading-relaxed text-slate-600">
          {aggiornamento ? (
            <>
              <span className="font-medium text-slate-700">
                Informativa privacy aggiornata al 19 settembre 2026.
              </span>{" "}
              Le domande scritte nello spazio di supporto sono ordinate da un
              sistema automatico, e la risposta è sempre scritta da una persona.
              Leggi l&apos;{" "}
              <Link href="/privacy?from=app" className="text-tt-blue underline">
                informativa privacy
              </Link>{" "}
              aggiornata.
            </>
          ) : (
            <>
              Il gestionale usa solo cookie tecnici necessari all&apos;accesso. Leggi
              l&apos;{" "}
              <Link href="/privacy?from=app" className="text-tt-blue underline">
                informativa privacy
              </Link>{" "}
              e la{" "}
              <Link href="/privacy?from=app#cookie" className="text-tt-blue underline">
                cookie policy
              </Link>{" "}
              prima di proseguire.
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => accetta()}
            className="tt-btn bg-tt-ink px-4 py-1.5 text-xs text-white hover:brightness-95"
          >
            Ho capito
          </button>
        </div>
        {erroreUi && (
          <p className="w-full text-xs text-red-600">{erroreUi}</p>
        )}
      </div>
    </div>
  );
}
