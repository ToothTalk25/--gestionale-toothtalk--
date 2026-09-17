"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approvaRegistrazione, ricertificaAccordoPec } from "@/app/actions-profilo";
import EliminaAccountAdmin from "@/components/EliminaAccountAdmin";

export type RigaRichiestaRegistrazione = {
  id: string;
  full_name: string | null;
  email: string;
  pec: string | null;
  on_screen: boolean;
};

export type RigaDaRicertificare = {
  id: string;
  full_name: string | null;
  email: string;
};

/**
 * Sezione admin "Richieste di registrazione": gli account creati ma non
 * ancora approvati (attivo=false). L'admin conferma/corregge il flag
 * "appare in video" (serve per la correttezza della revoca GDPR, non per
 * scegliere un accordo — l'accordo è unico per tutti) e approva. Chi non
 * viene approvato si respinge con EliminaAccountAdmin in contesto
 * "registrazione": stesso componente delle altre code, ma con testo di
 * conferma dedicato (nessun accordo/materiale esiste ancora a questo stadio)
 * ed eliminazione vera, non anonimizzazione — lo decide il server in base
 * allo stato reale del profilo.
 */
export default function RichiesteRegistrazione({
  richieste,
  daRicertificare = [],
}: {
  richieste: RigaRichiestaRegistrazione[];
  /** Accordi mandati via Gmail perché la PEC (Aruba) era bloccata: da rispedire via PEC vera appena risolve davvero. */
  daRicertificare?: RigaDaRicertificare[];
}) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [ricertificando, setRicertificando] = useState<string | null>(null);
  const [messaggioRicertifica, setMessaggioRicertifica] = useState<string | null>(null);

  async function ricertifica(userId: string) {
    setRicertificando(userId);
    setMessaggioRicertifica(null);
    const esito = await ricertificaAccordoPec(userId);
    setRicertificando(null);
    setMessaggioRicertifica(esito.ok ? "Rispedito via PEC." : `Errore: ${esito.errore}`);
    if (esito.ok) router.refresh();
  }

  // Flag on_screen corrente per ogni richiesta, correggibile dall'admin.
  const [onScreen, setOnScreen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(richieste.map((r) => [r.id, r.on_screen])),
  );

  async function approva(userId: string) {
    setInCorso(userId);
    setMessaggio(null);
    const esito = await approvaRegistrazione(userId, onScreen[userId] ?? false);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      esito.dati.viaGmail
        ? "Registrazione approvata: la PEC non è partita (Aruba), l'accordo è stato mandato via email normale. Segnato per essere ricertificato via PEC appena Aruba risolve il blocco."
        : "Registrazione approvata: la PEC con l'accordo è partita.",
    );
    router.refresh();
  }

  return (
    <>
      {daRicertificare.length > 0 && (
        <section className="tt-card mb-4 border border-amber-200 bg-amber-50/40 p-4 md:p-6">
          <h2 className="text-[15px] font-semibold text-amber-900">Accordi da ricertificare via PEC</h2>
          <p className="mt-1 text-xs text-amber-700">
            Mandati via email normale perché la PEC (Aruba) era bloccata — rispedisci via PEC vera quando il
            blocco è davvero risolto, non solo dichiarato tale: stesso documento, solo il canale cambia.
          </p>
          {messaggioRicertifica && <p className="mt-2 text-sm text-slate-600">{messaggioRicertifica}</p>}
          <div className="mt-3 space-y-2">
            {daRicertificare.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white p-3 text-sm">
                <div>
                  <p className="font-medium">{r.full_name ?? "—"}</p>
                  <p className="text-xs text-slate-500">{r.email}</p>
                </div>
                <button
                  onClick={() => ricertifica(r.id)}
                  disabled={ricertificando === r.id}
                  className="tt-btn bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {ricertificando === r.id ? "Rispedisco…" : "Ricertifica via PEC"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {richieste.length === 0 ? (
        <section className="tt-card p-4 md:p-6">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Richieste di registrazione</h2>
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Nessuna richiesta in attesa di approvazione. ✅
          </p>
        </section>
      ) : (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Richieste di registrazione</h2>
          <p className="mt-1 text-xs text-slate-400">
            Account creati ma non ancora attivi. Conferma se la persona appare in video
            (o no) e approva: l&apos;accordo editoriale parte via PEC al momento
            dell&apos;approvazione.
          </p>
        </div>
        <span className="rounded-full bg-[#fef3e2] px-[11px] py-[3px] text-xs font-semibold text-amber-700">
          {richieste.length} in attesa
        </span>
      </div>

      {messaggio && <p className="mt-3 text-sm text-slate-600">{messaggio}</p>}

      <div className="mt-3 space-y-2">
        {richieste.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-slate-200 p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{r.full_name ?? "—"}</p>
                <p className="text-xs text-slate-500">{r.email}</p>
                {r.pec && <p className="font-mono text-xs text-slate-400">{r.pec}</p>}
              </div>

              <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
                  <button
                    onClick={() =>
                      setOnScreen((s) => ({ ...s, [r.id]: true }))
                    }
                    className={`tt-btn px-2.5 py-1 text-xs transition ${
                      onScreen[r.id]
                        ? "bg-tt-blue text-white"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                    title="Appare in video (serve per la revoca GDPR)"
                  >
                    📹 In video
                  </button>
                  <button
                    onClick={() =>
                      setOnScreen((s) => ({ ...s, [r.id]: false }))
                    }
                    className={`tt-btn px-2.5 py-1 text-xs transition ${
                      !onScreen[r.id]
                        ? "bg-tt-blue text-white"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                    title="Non appare in video (backstage)"
                  >
                    🎨 Backstage
                  </button>
                </div>

                <button
                  onClick={() => approva(r.id)}
                  disabled={inCorso === r.id}
                  className="tt-btn bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {inCorso === r.id ? "Approvo…" : "Approva"}
                </button>

                <EliminaAccountAdmin userId={r.id} contesto="registrazione" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
      )}
    </>
  );
}
