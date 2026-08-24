"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { eseguiEliminazioneGrezzo, type RigaEliminazioneGrezzo } from "@/app/actions-profilo";

/** Candidato mostrato al Coordinatore per la revisione manuale. */
export type CandidatoGrezzo = {
  version_id: string;
  task_id: string;
  file_name: string;
  kind: string;
};

/**
 * Coda "Richieste di eliminazione materiale grezzo" (Accordo Art. 7.4): la
 * cancellazione alla revoca è MANUALE. Il Coordinatore vede i file candidati
 * (caricati da chi ha revocato — solo filtro di partenza, mai criterio
 * automatico), decide a occhio quali ritraggono la persona e li seleziona.
 */
export default function RichiesteEliminazioneGrezzo({
  richieste,
  candidati,
  nomi,
}: {
  richieste: RigaEliminazioneGrezzo[];
  candidati: Record<string, CandidatoGrezzo[]>;
  nomi: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selezionati, setSelezionati] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);

  const aperte = richieste.filter((r) => r.stato === "aperta");
  const risolte = richieste.filter((r) => r.stato === "risolta");

  if (aperte.length === 0 && risolte.length === 0) return null;

  function toggle(richiestaId: string, versionId: string) {
    setSelezionati((prev) => {
      const cur = prev[richiestaId] ?? [];
      const next = cur.includes(versionId)
        ? cur.filter((x) => x !== versionId)
        : [...cur, versionId];
      return { ...prev, [richiestaId]: next };
    });
  }

  function esegui(richiestaId: string) {
    setErrore(null);
    const ids = selezionati[richiestaId] ?? [];
    if (!ids.length) {
      setErrore("Seleziona almeno un file da eliminare.");
      return;
    }
    start(async () => {
      const res = await eseguiEliminazioneGrezzo(richiestaId, ids, note[richiestaId] ?? "");
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      setSelezionati((prev) => {
        const { [richiestaId]: _rimosso, ...rest } = prev;
        return rest;
      });
      setNote((prev) => {
        const { [richiestaId]: _rimosso, ...rest } = prev;
        return rest;
      });
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-amber-200">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Richieste di eliminazione materiale grezzo</h2>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Quando un Collaboratore revoca il consenso a immagine/voce si apre una
        richiesta con termine di 30 giorni. La cancellazione NON è automatica:
        individui a occhio quali file ritraggono davvero la persona e selezioni
        solo quelli. Il filtro iniziale (chi li ha caricati) serve solo a
        restringere la lista, non è un criterio di cancellazione.
      </p>

      {aperte.map((r) => {
        const scaduto = new Date(r.termine_scadenza) < new Date();
        const files = candidati[r.id] ?? [];
        const sel = selezionati[r.id] ?? [];
        return (
          <div key={r.id} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="font-medium text-amber-900">
              {nomi[r.user_id] ?? r.user_id.slice(0, 8)}
            </p>
            <p className="text-xs text-amber-700">
              Revocato il {new Date(r.richiesto_at).toLocaleDateString("it-IT")} — termine{" "}
              {scaduto ? "SCADUTO" : "entro"} il{" "}
              {new Date(r.termine_scadenza).toLocaleDateString("it-IT")}
            </p>
            {files.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Nessun file candidato (nessun materiale grezzo caricato da questo utente).
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {files.map((f) => (
                  <li key={f.version_id} className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={sel.includes(f.version_id)}
                      onChange={() => toggle(r.id, f.version_id)}
                    />
                    <span className="text-slate-700">{f.file_name}</span>
                    <span className="text-slate-400">({f.kind})</span>
                    <Link href={`/task/${f.task_id}`} className="text-tt-blue hover:underline">
                      apri task
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              value={note[r.id] ?? ""}
              onChange={(e) => setNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
              placeholder="Note del Coordinatore (facoltative)"
              rows={2}
              className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            />
            <button
              disabled={pending}
              onClick={() => esegui(r.id)}
              className="mt-2 tt-btn bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              Elimina i selezionati e chiudi
            </button>
          </div>
        );
      })}

      {errore && <p className="mt-2 text-xs text-red-600">{errore}</p>}

      {risolte.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">Già evase</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {risolte.map((r) => (
              <li key={r.id}>
                {nomi[r.user_id] ?? r.user_id.slice(0, 8)} — risolta il{" "}
                {r.risolta_at ? new Date(r.risolta_at).toLocaleDateString("it-IT") : "?"}
                {r.versioni_eliminate?.length
                  ? ` (${r.versioni_eliminate.length} file eliminati)`
                  : " (nessun file eliminato)"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

