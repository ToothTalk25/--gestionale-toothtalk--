"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { caricaModelloAccordo } from "@/app/actions-profilo";

export type RigaModelloAccordo = {
  id: string;
  storage_path: string;
  sha256: string;
  caricato_at: string;
  caricato_da: string | null;
  caricato_da_nome: string | null;
};

function sanifica(nome: string): string {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * Sezione admin "Modello accordo": carica il PDF del modello dell'accordo
 * editoriale (l'ultimo caricato è quello attivo, inviato alla PEC dei
 * collaboratori quando la registrazione viene approvata). Mostra anche la
 * cronologia dei modelli caricati.
 */
export default function CaricaModelloAccordo({ modelli }: { modelli: RigaModelloAccordo[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const attivo = modelli[0] ?? null;

  async function carica(file: File) {
    setErrore(null);
    setMessaggio(null);
    setInCorso(true);
    try {
      const { data: auth } = await supabaseBrowser().auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");

      const path = `modello-accordo/${crypto.randomUUID()}__${sanifica(file.name)}`;
      const { error: eUp } = await supabaseBrowser()
        .storage.from("finali")
        .upload(path, file, { upsert: false, contentType: file.type || "application/pdf" });
      if (eUp) throw new Error(eUp.message);

      const esito = await caricaModelloAccordo(path);
      if (!esito.ok) throw new Error(esito.errore);

      setMessaggio("Modello dell'accordo caricato. È ora il modello attivo.");
      router.refresh();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Upload fallito.");
    } finally {
      setInCorso(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Modello accordo editoriale</h2>
          <p className="mt-1 text-xs text-slate-400">
            Il documento inviato ai collaboratori quando la registrazione viene approvata.
            L&apos;ultimo caricato è quello attivo.
          </p>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={inCorso}
          className="tt-btn bg-tt-ink px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
        >
          {inCorso ? "Carico…" : "Carica nuovo modello"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void carica(f);
          }}
        />
      </div>

      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
      {messaggio && <p className="mt-3 text-sm text-emerald-700">{messaggio}</p>}

      {attivo && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
          <p className="font-medium">Modello attivo</p>
          <p className="text-xs text-slate-600">
            Caricato il {new Date(attivo.caricato_at).toLocaleString("it-IT")}
            {attivo.caricato_da_nome ? ` · ${attivo.caricato_da_nome}` : ""}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
            SHA-256: {attivo.sha256}
          </p>
        </div>
      )}

      {modelli.length === 0 && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Nessun modello caricato. Caricane uno: non puoi approvare registrazioni senza.
        </p>
      )}

      {modelli.length > 1 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-slate-500">Cronologia modelli</h3>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {modelli.slice(1).map((m) => (
              <li key={m.id} className="border-b border-slate-50 py-1">
                {new Date(m.caricato_at).toLocaleString("it-IT")}
                {m.caricato_da_nome ? ` · ${m.caricato_da_nome}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
