"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eseguiControlloIntegrita } from "@/app/actions-profilo";

export type RigaControlloIntegrita = {
  id: string;
  eseguita_at: string;
  origine: string;
  esito: string;
  deliverable_controllate: number;
  versioni_controllate: number;
  catene_rotte: number;
  pacchetti_controllati: number;
  manifesti_rotti: number;
  file_mancanti: number;
  file_dimensione_diversa: number;
  problemi: unknown;
};

/** Traduce un problema del registro in una riga leggibile. */
function descriviProblema(p: Record<string, unknown>): string {
  switch (p.tipo) {
    case "catena_rotta":
      return `Catena di impronte rotta: la versione ${p.versione} di ${p.file ?? "un materiale"} non corrisponde al record che la registra.`;
    case "manifesto_non_torna":
      return `L'impronta del manifesto del pacchetto ${p.pacchetto} non corrisponde a quella registrata.`;
    case "file_mancante":
      return `File non trovato nello storage: ${p.percorso} (versione ${p.versione}).`;
    case "dimensione_diversa":
      return `File di dimensione diversa dal registrato: ${p.percorso ?? p.versione} — attesi ${p.attesa} byte, trovati ${p.trovata}.`;
    default:
      return JSON.stringify(p);
  }
}

/** Chi ha chiesto il controllo: la differenza conta quando se ne legge l'esito. */
const ORIGINI: Record<string, string> = {
  cron: "sveglia notturna nel database",
  "cron-vercel": "controllo giornaliero dell'app",
  manuale: "chiesto a mano dal Registro",
};

/**
 * Sezione admin "Integrità dei depositi": l'esito dei controlli automatici
 * sulle catene di impronte, sui manifesti dei pacchetti sigillati e sulla
 * presenza dei file. Il controllo gira da solo ogni notte (0138); il pulsante
 * serve a chiederlo adesso, prima di pubblicare o dopo una segnalazione.
 */
export default function SezioneIntegrita({ controlli }: { controlli: RigaControlloIntegrita[] }) {
  const router = useRouter();
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const ultimo = controlli[0] ?? null;
  const problemiUltimo = Array.isArray(ultimo?.problemi)
    ? (ultimo!.problemi as Record<string, unknown>[])
    : [];

  async function controlla() {
    setInCorso(true);
    setMessaggio(null);
    const esito = await eseguiControlloIntegrita();
    setInCorso(false);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    const d = esito.dati;
    setMessaggio(
      d.esito === "integro"
        ? `Tutto integro: ricontrollate ${d.versioni_controllate} versioni in ${d.deliverable_controllate} materiali e ${d.pacchetti_controllati} pacchetti sigillati.`
        : `Problemi trovati: ${d.catene_rotte} catene rotte, ${d.manifesti_rotti} manifesti che non tornano, ${d.file_mancanti} file mancanti, ${d.file_dimensione_diversa} file di dimensione diversa.`,
    );
    router.refresh();
  }

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Integrità dei depositi</h2>
          <p className="mt-1 text-xs text-slate-400">
            Ogni notte il gestionale ricontrolla da solo le catene di impronte di ogni materiale,
            l&apos;impronta dei manifesti dei pacchetti sigillati e la presenza dei file. Qui c&apos;è
            l&apos;esito, con la data.
          </p>
        </div>
        <button
          onClick={controlla}
          disabled={inCorso}
          className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {inCorso ? "Controllo…" : "Controlla adesso"}
        </button>
      </div>

      {messaggio && <p className="mt-3 text-sm text-slate-600">{messaggio}</p>}

      {!ultimo && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Nessun controllo ancora registrato: il primo gira la prossima notte, oppure usa
          &quot;Controlla adesso&quot;.
        </p>
      )}

      {ultimo && (
        <div
          className={`mt-4 rounded-lg border p-3 ${
            ultimo.esito === "integro"
              ? "border-emerald-200 bg-emerald-50/50"
              : "border-red-200 bg-red-50/50"
          }`}
        >
          <p
            className={`text-[13px] font-semibold ${
              ultimo.esito === "integro" ? "text-emerald-800" : "text-red-800"
            }`}
          >
            {ultimo.esito === "integro"
              ? "Ultimo controllo: tutto integro ✅"
              : "Ultimo controllo: problemi trovati"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {new Date(ultimo.eseguita_at).toLocaleString("it-IT")} ·{" "}
            {ORIGINI[ultimo.origine] ?? ultimo.origine} · ricontrollati {ultimo.versioni_controllate}{" "}
            depositi in {ultimo.deliverable_controllate} materiali e {ultimo.pacchetti_controllati}{" "}
            pacchetti sigillati
          </p>

          {problemiUltimo.length > 0 && (
            <>
              <ul className="mt-2 space-y-1 text-xs text-red-800">
                {problemiUltimo.slice(0, 20).map((p, i) => (
                  <li key={i}>• {descriviProblema(p)}</li>
                ))}
                {problemiUltimo.length > 20 && (
                  <li>…e altri {problemiUltimo.length - 20} problemi nello stesso controllo.</li>
                )}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                Non è un guasto del gestionale: è un dato che non corrisponde alla propria impronta.
                Finché non è chiarito, quel materiale non va considerato certificato.
              </p>
            </>
          )}
        </div>
      )}

      {controlli.length > 1 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">Controlli precedenti</p>
          <div className="mt-2 space-y-1">
            {controlli.slice(1).map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-1.5 text-xs text-slate-500"
              >
                <span>{new Date(c.eseguita_at).toLocaleString("it-IT")}</span>
                <span>{ORIGINI[c.origine] ?? c.origine}</span>
                <span className={c.esito === "integro" ? "text-emerald-700" : "text-red-700"}>
                  {c.esito === "integro"
                    ? "integro"
                    : `${c.catene_rotte + c.manifesti_rotti + c.file_mancanti + c.file_dimensione_diversa} problemi`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}