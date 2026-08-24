"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Peso = "leggero" | "grave";

type OpzioniConferma = {
  titolo: string;
  descrizione?: string;
  /** "grave" = irreversibile (bottone rosso), "leggero" = si può disfare (bottone scuro). */
  peso?: Peso;
  testoConferma?: string;
  /** Due colonne "cosa si perde / cosa si conserva", solo per le azioni più gravi. */
  colonne?: { perde: string[]; conserva: string[] };
};

type StatoDialogo = OpzioniConferma & { risolvi: (v: boolean) => void };

/**
 * Sostituisce window.confirm(): non è solo estetica, è affidabilità. I
 * dialoghi nativi vengono soppressi in troppi contesti (webview, PWA
 * installata, browser automatizzati) — silenziosamente, senza errore: il
 * bottone sembra non fare nulla. Una finestra in pagina non ha questo
 * problema, e in più permette di spiegare le conseguenze invece di
 * schiacciarle in una singola stringa di sistema.
 *
 * Uso: const { chiedi, dialogo } = useConferma(); poi `if (!(await chiedi({...}))) return;`
 * al posto di `if (!window.confirm(...)) return;` — stesso punto di ritorno,
 * stessa forma. Renderizzare {dialogo} una volta nel componente.
 */
export function useConferma() {
  const [stato, setStato] = useState<StatoDialogo | null>(null);

  const chiedi = useCallback((opts: OpzioniConferma) => {
    return new Promise<boolean>((risolvi) => {
      setStato({ ...opts, risolvi });
    });
  }, []);

  function chiudi(risultato: boolean) {
    stato?.risolvi(risultato);
    setStato(null);
  }

  const dialogo = stato ? (
    <ConfermaDialog {...stato} onAnnulla={() => chiudi(false)} onConferma={() => chiudi(true)} />
  ) : null;

  return { chiedi, dialogo };
}

function ConfermaDialog({
  titolo,
  descrizione,
  peso = "grave",
  testoConferma = "Conferma",
  colonne,
  onAnnulla,
  onConferma,
}: OpzioniConferma & { onAnnulla: () => void; onConferma: () => void }) {
  const annullaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    annullaRef.current?.focus();
    function suEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onAnnulla();
    }
    document.addEventListener("keydown", suEsc);
    return () => document.removeEventListener("keydown", suEsc);
  }, [onAnnulla]);

  const grave = peso === "grave";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-tt-ink/45 sm:items-center sm:p-4"
      onClick={onAnnulla}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="conferma-titolo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-[0_28px_60px_-24px_rgba(23,40,55,0.42)] sm:rounded-3xl"
      >
        <div className="flex items-start gap-3.5">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
              grave ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
            }`}
            aria-hidden
          >
            {grave ? (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l9 16H3z" />
                <path d="M12 9v4.5" />
                <circle cx="12" cy="16.8" r=".6" fill="currentColor" stroke="none" />
              </svg>
            ) : (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            )}
          </span>
          <div className="flex-1">
            <h2 id="conferma-titolo" className="text-[17px] font-semibold leading-snug text-tt-ink">
              {titolo}
            </h2>
            {descrizione && <p className="mt-2 text-sm leading-relaxed text-slate-500">{descrizione}</p>}
          </div>
        </div>

        {colonne && (
          <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
            <div className="bg-white p-3.5">
              <p className="mb-1.5 text-[11px] font-semibold text-red-600">Viene eliminato</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-slate-500">
                {colonne.perde.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
            <div className="bg-white p-3.5">
              <p className="mb-1.5 text-[11px] font-semibold text-emerald-700">Viene conservato</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-slate-500">
                {colonne.conserva.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            ref={annullaRef}
            onClick={onAnnulla}
            className="tt-btn w-full border border-slate-200 bg-white px-5 py-2.5 text-[13.5px] text-slate-600 hover:bg-slate-50 sm:w-auto"
          >
            Annulla
          </button>
          <button
            onClick={onConferma}
            className={`tt-btn w-full px-5 py-2.5 text-[13.5px] text-white sm:w-auto ${
              grave ? "bg-red-600 hover:brightness-95" : "bg-tt-ink hover:brightness-110"
            }`}
          >
            {testoConferma}
          </button>
        </div>
      </div>
    </div>
  );
}
