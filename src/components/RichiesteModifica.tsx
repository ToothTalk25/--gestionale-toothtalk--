"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { apriRichiesta, confermaRichiesta, segnaFatta } from "@/app/actions-revisione";
import {
  AMBITO_LABEL,
  type AmbitoRichiesta,
  type PacchettoStato,
  type RichiestaModifica,
} from "@/lib/types";

const STATI_SENZA_CORREZIONI: PacchettoStato[] = [
  "sigillato",
  "pec_inviata",
  "pec_confermata",
  "pec_errore",
];

const AMBITI: AmbitoRichiesta[] = [
  "video",
  "copertina",
  "descrizione",
  "script",
  "titolo_youtube",
  "generale",
];

export default function RichiesteModifica({
  taskId,
  pacchettoId,
  pacchettoStato,
  richieste,
  nomi,
  isAdmin,
  compatta = false,
}: {
  taskId: string;
  pacchettoId: string | null;
  pacchettoStato?: PacchettoStato | null;
  richieste: RichiestaModifica[];
  nomi: Record<string, string>;
  isAdmin: boolean;
  compatta?: boolean;
}) {
  const sigillato = !!pacchettoStato && STATI_SENZA_CORREZIONI.includes(pacchettoStato);
  const router = useRouter();
  const [ambito, setAmbito] = useState<AmbitoRichiesta>("generale");
  const [testo, setTesto] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const aperte = richieste.filter((r) => r.stato === "aperta");
  const daVerificare = richieste.filter((r) => r.stato === "da_verificare");
  const risolte = richieste.filter((r) => r.stato === "risolta");

  return (
    <div className={compatta ? "" : "tt-card p-6"}>
      {!compatta && (
        <>
          <h2 className="text-lg font-medium">Modifiche richieste</h2>
          <p className="mt-1 text-sm text-slate-500">
            Le correzioni da fare prima di sigillare. Aprirne una rimanda il
            pacchetto in composizione: il gruppo la vede e può intervenire
            subito. Non si sigilla finché resta una richiesta aperta.
          </p>
        </>
      )}

      {aperte.length === 0 && daVerificare.length === 0 && risolte.length === 0 && (
        <p className={compatta ? "text-xs text-slate-400" : "mt-3 text-sm text-slate-400"}>
          Nessuna modifica richiesta.
        </p>
      )}

      {aperte.length > 0 && (
        <ul className="mt-3 space-y-2">
          {aperte.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border-l-4 border-amber-400 bg-amber-50 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <AmbitoTag ambito={r.ambito} />
                <span className="text-xs text-slate-500">
                  {new Date(r.creata_at).toLocaleString("it-IT")}
                  {r.creata_da ? ` · ${nomi[r.creata_da] ?? ""}` : ""}
                </span>
                <button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setErrore(null);
                      const esito = await segnaFatta(taskId, r.id);
                      if (!esito.ok) setErrore(esito.errore);
                      else router.refresh();
                    })
                  }
                  className="ml-auto text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                >
                  {isAdmin ? "Segna come risolta" : "Segna come fatta"}
                </button>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{r.testo}</p>
            </li>
          ))}
        </ul>
      )}

      {daVerificare.length > 0 && (
        <ul className="mt-3 space-y-2">
          {daVerificare.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border-l-4 border-sky-400 bg-sky-50 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <AmbitoTag ambito={r.ambito} />
                <span className="text-xs text-slate-500">
                  segnalata fatta{" "}
                  {r.completata_at ? new Date(r.completata_at).toLocaleString("it-IT") : ""}
                  {r.completata_da ? ` da ${nomi[r.completata_da] ?? ""}` : ""} · da confermare
                </span>
                {isAdmin && (
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setErrore(null);
                          const esito = await confermaRichiesta(taskId, r.id, true);
                          if (!esito.ok) setErrore(esito.errore);
                          else router.refresh();
                        })
                      }
                      className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50"
                    >
                      Confermo, risolta ✓
                    </button>
                    <button
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          setErrore(null);
                          const esito = await confermaRichiesta(taskId, r.id, false);
                          if (!esito.ok) setErrore(esito.errore);
                          else router.refresh();
                        })
                      }
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      Non ancora, riapri
                    </button>
                  </span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{r.testo}</p>
            </li>
          ))}
        </ul>
      )}

      {risolte.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">
            {risolte.length} già risolte
          </summary>
          <ul className="mt-2 space-y-1.5">
            {risolte.map((r) => (
              <li key={r.id} className="rounded-lg bg-slate-50 p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="font-medium">{AMBITO_LABEL[r.ambito]}</span>
                  <span>
                    risolta il{" "}
                    {r.risolta_at
                      ? new Date(r.risolta_at).toLocaleString("it-IT")
                      : "—"}
                    {r.risolta_da ? ` da ${nomi[r.risolta_da] ?? ""}` : ""}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {r.testo}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {isAdmin && sigillato && (
        <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400">
          Il pacchetto è già sigillato: da qui non si aprono più correzioni.
          Per farne comporre uno nuovo usa &quot;Annulla pacchetto&quot; nella
          sezione del video completo (motivo obbligatorio, il sigillo
          originale resta a registro).
        </p>
      )}

      {isAdmin && !sigillato && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={ambito}
              onChange={(e) => setAmbito(e.target.value as AmbitoRichiesta)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              {AMBITI.map((a) => (
                <option key={a} value={a}>
                  {AMBITO_LABEL[a]}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">
              cosa va corretto in questo video
            </span>
          </div>

          <textarea
            rows={3}
            value={testo}
            onChange={(e) => setTesto(e.target.value)}
            placeholder="Es. la copertina è sfocata, rifarla con il testo più grande…"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <button
            disabled={pending || !testo.trim()}
            onClick={() =>
              start(async () => {
                setErrore(null);
                const esito = await apriRichiesta(
                  taskId,
                  pacchettoId,
                  ambito,
                  testo,
                );
                if (!esito.ok) setErrore(esito.errore);
                else {
                  setTesto("");
                  router.refresh();
                }
              })
            }
            className="mt-2 rounded-lg bg-tt-ink px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            {pending ? "Invio…" : "Richiedi modifica"}
          </button>
        </div>
      )}

      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}
    </div>
  );
}

/** Etichetta dell'ambito; se corrisponde a una sezione della pagina, ci porta direttamente. */
function AmbitoTag({ ambito }: { ambito: AmbitoRichiesta }) {
  const testo = (
    <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">
      {AMBITO_LABEL[ambito]}
    </span>
  );
  if (ambito === "generale") return testo;
  return (
    <a href={`#${ambito}`} className="hover:opacity-80" title="Vai alla sezione">
      {testo}
    </a>
  );
}
