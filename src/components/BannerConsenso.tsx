"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { registraConsenso } from "@/app/actions-profilo";
import { COOKIE_VERSION, PRIVACY_VERSION } from "@/lib/types";

/**
 * Banner di consenso GDPR: appare finché l'utente non ha accettato la
 * versione corrente dell'informativa privacy e della cookie policy.
 * Ogni accettazione viene registrata (consenso dimostrabile).
 */
export default function BannerConsenso() {
  const [stato, setStato] = useState<"caricamento" | "visibile" | "nascosto">("caricamento");
  const [erroreUi, setErroreUi] = useState<string | null>(null);

  useEffect(() => {
    let attivo = true;
    (async () => {
      try {
        const { data: auth } = await supabaseBrowser().auth.getUser();
        if (!auth.user) {
          setStato("nascosto");
          return;
        }
        const { data: consensi } = await supabaseBrowser()
          .from("consensi")
          .select("tipo, versione, revocato_at")
          .eq("user_id", auth.user.id);
        const lista = consensi ?? [];
        const privacyOk = lista.some((c) => c.tipo === "privacy" && c.versione === PRIVACY_VERSION && !c.revocato_at);
        const cookieOk = lista.some((c) => c.tipo === "cookie" && c.versione === COOKIE_VERSION && !c.revocato_at);
        if (attivo) setStato(privacyOk && cookieOk ? "nascosto" : "visibile");
      } catch {
        if (attivo) setStato("nascosto");
      }
    })();
    return () => {
      attivo = false;
    };
  }, []);

  if (stato !== "visibile") return null;

  // Un solo pulsante, un solo consenso di fatto: il gestionale usa solo
  // cookie tecnici, quindi non esiste una scelta reale fra "tutto" e "solo
  // necessari" da offrire. Registriamo entrambi i tipi di consenso insieme
  // (privacy + cookie), e chiudiamo il banner SOLO se entrambi sono andati
  // a buon fine — altrimenti ricompare al prossimo giro, invece di
  // ricomparire per sempre come nel comportamento precedente.
  async function accetta() {
    setErroreUi(null);
    let tuttoOk = true;
    try {
      const r1 = await registraConsenso("privacy");
      if (!r1.ok) {
        setErroreUi(r1.errore);
        tuttoOk = false;
      }
      const r2 = await registraConsenso("cookie");
      if (!r2.ok) {
        setErroreUi((e) => (e ? e + " · " : "") + r2.errore);
        tuttoOk = false;
      }
    } catch (e) {
      // La server action ha lanciato: il consenso potrebbe non essere stato
      // registrato. Non chiudiamo il banner, mostriamo l'errore.
      setErroreUi("Errore durante il salvataggio: " + (e instanceof Error ? e.message : String(e)));
      tuttoOk = false;
    }
    // Chiudi SOLO se il consenso è stato davvero registrato: un'accettazione
    // non salvata non è un'accettazione.
    if (tuttoOk) setStato("nascosto");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <p className="flex-1 text-xs leading-relaxed text-slate-600">
          Il gestionale usa solo cookie tecnici necessari all&apos;accesso. Leggi
          l&apos;{" "}
          <Link href="/privacy" className="text-tt-blue underline">
            informativa privacy
          </Link>{" "}
          e la{" "}
          <Link href="/privacy#cookie" className="text-tt-blue underline">
            cookie policy
          </Link>{" "}
          prima di proseguire.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => accetta()}
            className="rounded-lg bg-tt-ink px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
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
