"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { eliminaAccount } from "@/app/actions-profilo";

/**
 * Sezione "fine della collaborazione": nascosta dietro un piccolo tasto per
 * non attirare l'attenzione. Solo chi lo apre davvero vede la spiegazione e
 * i controlli per eliminare l'account.
 */
export default function SezioneEliminazioneAccount({ userId }: { userId: string }) {
  const router = useRouter();
  const [aperta, setAperta] = useState(false);
  const [consapevole, setConsapevole] = useState(false);
  const [art94, setArt94] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  async function elimina() {
    setInCorso(true);
    setErrore(null);
    setMessaggio(null);

    // art94: conferma obbligatoria della cancellazione delle copie locali
    // (Art. 9.4 Accordo) — richiesta SOLO per chi elimina il proprio account.
    const esito = await eliminaAccount(userId, true, art94);
    if (!esito.ok) {
      setErrore(esito.errore);
      setInCorso(false);
      return;
    }

    await supabaseBrowser().auth.signOut();
    setMessaggio("Account eliminato. Tutti i tuoi dati personali sono stati rimossi.");
    setTimeout(() => router.replace("/login"), 2500);
  }

  if (!aperta) {
    return (
      <div className="flex justify-end">
        <button
          onClick={() => setAperta(true)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-400 transition hover:border-red-200 hover:text-red-600"
        >
          Fine della collaborazione
        </button>
      </div>
    );
  }

  return (
    <section className="tt-card border border-red-200 p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-lg font-medium text-red-700">Fine della collaborazione</h2>
        <button
          onClick={() => setAperta(false)}
          className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
        >
          Chiudi ✕
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Tutti i dati trattati dal gestionale — l&apos;accordo firmato, la foto, i
        materiali e l&apos;anagrafica — vengono elaborati <strong>solo su questa
        piattaforma</strong>: non serve che tu conservi nulla altrove. Se
        interrompi la collaborazione, puoi eliminare qui l&apos;account con tutti i
        dati che hai trasmesso.
      </p>

      <div className="mt-3 rounded-lg bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
        <p className="font-medium text-slate-800">Cosa viene eliminato:</p>
        <ul className="mt-1 list-disc pl-5">
          <li>la foto del profilo</li>
          <li>i consensi e le appartenenze ai gruppi</li>
          <li>il video grezzo che ti riprende (immagine e voce)</li>
          <li>i dati di contatto e la possibilità di accedere</li>
        </ul>
        <p className="mt-2 font-medium text-slate-800">Cosa viene conservato:</p>
        <ul className="mt-1 list-disc pl-5">
          <li>
            l&apos;accordo firmato, che contiene la cessione di proprietà del
            contenuto — titolo necessario al progetto
          </li>
          <li>script, copertina e descrizione (già certificati via PEC)</li>
          <li>l&apos;archivio certificato e le copie PEC, immutabili per legge</li>
        </ul>
      </div>

      {messaggio && <p className="mt-3 text-sm text-emerald-700">{messaggio}</p>}
      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}

      <label className="mt-4 flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={consapevole}
          onChange={(e) => setConsapevole(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Sono consapevole che elimino l&apos;account e tutti i miei dati personali.
          Questa azione non è reversibile.
        </span>
      </label>

      {/* Art. 9.4 Accordo: comunicazione obbligatoria della cancellazione
          delle copie locali, prima che l'account venga eliminato. */}
      <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={art94}
          onChange={(e) => setArt94(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Confermo di aver cancellato tutte le copie locali dei materiali
          grezzi, dei recapiti e degli altri dati personali di terzi ancora in
          mio possesso, ai sensi dell&apos;Art. 9.4 dell&apos;Accordo Editoriale.
        </span>
      </label>

      <button
        disabled={!consapevole || !art94 || inCorso}
        onClick={elimina}
        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {inCorso ? "Elimino…" : "Elimina il mio account e i miei dati"}
      </button>
    </section>
  );
}
