"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { caricaRinnovoAccordo } from "@/app/actions-profilo";
import type { Profile } from "@/lib/types";

function sanifica(nome: string) {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Card di caricamento del documento di rinnovo dell'Accordo (Art. 9.1),
 * condivisa tra la pagina /rinnovo (destinazione obbligata a scadenza
 * avvenuta) e la sezione "Rinnovo" di /profilo (caricamento ANTICIPATO,
 * permesso in qualsiasi momento, senza perdere l'accesso). Mostra la
 * scadenza corrente e lo stato del rinnovo in attesa; il caricamento è
 * disponibile per chiunque abbia un accordo approvato.
 */
export default function CaricaRinnovo({ profile }: { profile: Profile }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [inCorso, setInCorso] = useState(false);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const scadenzaIt = profile.accordo_scadenza
    ? new Date(`${profile.accordo_scadenza}T00:00:00`).toLocaleDateString("it-IT")
    : null;
  const rinnovoCaricatoIl = profile.rinnovo_caricato_at
    ? new Date(profile.rinnovo_caricato_at).toLocaleString("it-IT")
    : null;

  async function carica() {
    const file = input.current?.files?.[0];
    if (!file) return;
    setErrore(null);
    setMessaggio(null);
    setInCorso(true);
    try {
      const { data: auth } = await supabaseBrowser().auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");

      const path = `${uid}/rinnovo/${crypto.randomUUID()}__${sanifica(file.name)}`;
      const { error: eUpload } = await supabaseBrowser()
        .storage.from("profili")
        .upload(path, file, { upsert: false });
      if (eUpload) throw new Error(eUpload.message);

      // L'impronta viene ricalcolata lato server: qui non serve calcolarla.
      const esito = await caricaRinnovoAccordo(path, "");
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setMessaggio(
        "Documento di rinnovo caricato. Il Coordinatore lo approverà per spostare la scadenza di 6 mesi avanti.",
      );
      router.refresh();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Caricamento fallito.");
    } finally {
      setInCorso(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold tracking-[-0.015em] text-slate-800">
        Rinnovo dell&apos;Accordo (Art. 9.1)
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        L&apos;Accordo ha durata fissa di 6 mesi. Puoi caricare il documento di
        rinnovo firmato in qualsiasi momento, anche con grande anticipo: non
        devi aspettare la scadenza.
      </p>
      {scadenzaIt && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Il tuo Accordo scade il <strong>{scadenzaIt}</strong>.
        </p>
      )}

      {profile.rinnovo_path ? (
        <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <p className="font-medium">Documento di rinnovo in attesa di approvazione</p>
          {rinnovoCaricatoIl && (
            <p className="mt-0.5 text-xs text-blue-700">
              Caricato il {rinnovoCaricatoIl}. L&apos;approvazione del Coordinatore
              sposta la scadenza di 6 mesi avanti.
            </p>
          )}
          <p className="mt-2 text-xs text-blue-700">
            Hai caricato per errore il documento sbagliato? Ricaricalo qui
            sotto: sostituisce quello in attesa.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-400">
          Nessun documento di rinnovo ancora caricato.
        </p>
      )}

      <input
        ref={input}
        data-testid="file-rinnovo"
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={() => carica()}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={inCorso}
        className="mt-3 tt-btn border border-slate-300 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        {inCorso ? "Carico…" : profile.rinnovo_path ? "Sostituisci documento di rinnovo" : "Carica documento di rinnovo"}
      </button>

      {messaggio && <p className="mt-3 text-sm text-emerald-700">{messaggio}</p>}
      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
    </div>
  );
}
