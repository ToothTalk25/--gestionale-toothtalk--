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
          .select("tipo, versione")
          .eq("user_id", auth.user.id);
        const lista = consensi ?? [];
        const privacyOk = lista.some((c) => c.tipo === "privacy" && c.versione === PRIVACY_VERSION);
        const cookieOk = lista.some((c) => c.tipo === "cookie" && c.versione === COOKIE_VERSION);
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

  async function accetta(tutto: boolean) {
    await registraConsenso("privacy");
    if (tutto) await registraConsenso("cookie");
    setStato("nascosto");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
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
            onClick={() => accetta(false)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Solo necessari
          </button>
          <button
            onClick={() => accetta(true)}
            className="rounded-lg bg-tt-ink px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Accetta tutto
          </button>
        </div>
      </div>
    </div>
  );
}
