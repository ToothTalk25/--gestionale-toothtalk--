"use client";

import { useState } from "react";
import {
  scaricaAccordo,
  scaricaDocumentoNomina,
  esportaDatiPersonali,
} from "@/app/actions-profilo";

/**
 * Documenti propri dell'uscente: accordo firmato, modulo di nomina ed
 * esportazione dati (portabilità, art. 20 GDPR). Restano accessibili a
 * prescindere dalla conferma Art. 9.4: il diritto di accesso ai propri
 * documenti (art. 15 GDPR, promesso nell'informativa) non può dipendere
 * dagli adempimenti post-uscita — la conferma è un passaggio autonomo.
 */
export default function DocumentiUscente() {
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  async function apri(
    azione: () => Promise<{ ok: boolean; dati?: string; errore?: string }>,
  ) {
    setErrore(null);
    setMessaggio(null);
    const finestra = window.open("", "_blank");
    const esito = await azione();
    if (!esito.ok) {
      finestra?.close();
      setErrore(esito.errore ?? "Errore.");
      return;
    }
    if (finestra) finestra.location.href = esito.dati as string;
    else window.open(esito.dati as string, "_blank");
  }

  async function esporta() {
    setErrore(null);
    setMessaggio(null);
    const esito = await esportaDatiPersonali();
    if (!esito.ok) {
      setErrore(esito.errore);
      return;
    }
    const blob = new Blob([esito.dati.contenuto], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = esito.dati.nome;
    a.click();
    URL.revokeObjectURL(url);
    setMessaggio("Esportazione pronta: controlla i download del browser.");
  }

  return (
    <section className="tt-card p-6">
      <h2 className="text-base font-medium">I tuoi documenti</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">
        Restano a tua disposizione, a prescindere dalla conferma qui sotto
        (diritto di accesso ai tuoi dati — art. 15 GDPR, e portabilità — art.
        20 GDPR).
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => apri(() => scaricaAccordo())}
          className="tt-btn border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Scarica il tuo accordo firmato
        </button>
        <button
          onClick={() => apri(() => scaricaDocumentoNomina())}
          className="tt-btn border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Scarica il tuo modulo di nomina
        </button>
        <button
          onClick={esporta}
          className="tt-btn border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Esporta i tuoi dati (portabilità GDPR)
        </button>
      </div>
      {messaggio && <p className="mt-2 text-xs text-emerald-700">{messaggio}</p>}
      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}
    </section>
  );
}
