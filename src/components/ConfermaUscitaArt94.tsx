"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { confermaCancellazioneCopie } from "@/app/actions-profilo";

/**
 * Conferma Art. 9.4 dell'Accordo Editoriale per il Collaboratore uscente:
 * la "comunicazione al Coordinatore" della cancellazione delle copie locali
 * dei materiali grezzi, dei recapiti e dei dati personali di terzi, entro 48
 * ore dalla cessazione. Una checkbox + bottone, stesso pattern già usato per
 * "ho letto e compreso" l'accordo. La conferma viene registrata con data e
 * ora nella catena di audit immutabile del gestionale, poi l'account viene
 * scollegato: l'accesso a questa pagina era l'unico residuo disponibile.
 */
export default function ConfermaUscitaArt94() {
  const router = useRouter();
  const [conferma, setConferma] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);

  async function invia() {
    setInCorso(true);
    setErrore(null);
    const esito = await confermaCancellazioneCopie();
    if (!esito.ok) {
      setErrore(esito.errore);
      setInCorso(false);
      return;
    }
    setFatto(true);
    await supabaseBrowser().auth.signOut();
    setTimeout(() => router.replace("/login"), 1800);
    router.refresh();
  }

  if (fatto) {
    return (
      <div className="w-full max-w-lg tt-card p-6 text-center">
        <p className="text-sm text-emerald-700">
          Grazie: la tua conferma è stata registrata con data e ora nel
          registro del gestionale. Buona continuazione!
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg tt-card p-6">
      <p className="text-[11px] uppercase tracking-[.12em] text-slate-400">
        ToothTalk — fine della collaborazione
      </p>
      <h1 className="mt-1 text-lg font-medium">Un&apos;ultima cosa, prima di chiudere</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        La tua collaborazione con il Progetto è terminata. L&apos;Accordo
        Editoriale (Art. 9.4) ti chiede di procedere alla cancellazione
        definitiva di qualsiasi copia locale dei materiali grezzi, dei
        recapiti e degli altri dati personali di terzi ancora in tuo
        possesso, entro 48 ore dalla cessazione, dandone comunicazione al
        Coordinatore. Questa conferma è quella comunicazione: è un
        passaggio autonomo e non condiziona in alcun modo l&apos;accesso ai
        tuoi documenti qui sopra.
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={conferma}
          onChange={(e) => setConferma(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-tt-blue"
        />
        <span>
          Confermo di aver cancellato tutte le copie locali dei materiali
          grezzi, dei recapiti e degli altri dati personali di terzi ancora
          in mio possesso, ai sensi dell&apos;Art. 9.4 dell&apos;Accordo Editoriale.
        </span>
      </label>

      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}

      <button
        disabled={!conferma || inCorso}
        onClick={invia}
        className="tt-btn mt-5 w-full bg-tt-ink px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
      >
        {inCorso ? "Registro…" : "Conferma e chiudi"}
      </button>

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        La conferma viene registrata con data e ora nel registro del
        gestionale (catena di audit immutabile). Se non la dai entro 48 ore,
        resterà visibile al Coordinatore come &quot;conferma non ancora
        ricevuta&quot;. Puoi comunque scaricare i tuoi documenti anche senza
        averla data.
      </p>
    </div>
  );
}
