"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import { urlFirmato, preparaUploadDocumento, registraDocumentoMagazzino, eliminaDocumentoMagazzino } from "@/app/actions";
import { useConferma } from "@/components/ConfermaAzione";
import type { DocumentoMagazzino } from "@/lib/types";

/** Formati che ha senso trovare in un magazzino di materiali di servizio. */
const ACCETTATI =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.rtf,.odt,.ods,.png,.jpg,.jpeg,.webp,.svg,.zip";

/** Peso leggibile: un elenco di byte non dice niente a colpo d'occhio. */
function peso(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Magazzino documenti del gruppo: materiali di servizio che non
 * appartengono a un progetto (moduli, guide, immagini, riferimenti).
 * Sta nella zona di lavoro: qui si deposita, si scarica e si elimina
 * liberamente, e non c'è nessuna catena di impronte da preservare.
 */
export default function MagazzinoDocumenti({
  poloId,
  documenti,
}: {
  poloId: string;
  documenti: DocumentoMagazzino[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { chiedi, dialogo } = useConferma();
  const [inCorso, setInCorso] = useState(false);
  const [avanzamento, setAvanzamento] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  /**
   * Un file per volta: il browser carica dritto su Storage con l'URL
   * firmato dal server, poi si registrano solo i metadati.
   */
  async function depositaUno(file: File) {
    const prep = await preparaUploadDocumento(poloId, file.name);
    if (!prep.ok) throw new Error(prep.errore);

    const { error: eUp } = await supabaseBrowser()
      .storage.from(prep.dati.bucket)
      .uploadToSignedUrl(prep.dati.path, prep.dati.token, file, {
        contentType: file.type || "application/octet-stream",
      });
    if (eUp) throw new Error(eUp.message);

    const sha256 = await sha256File(file);

    const esito = await registraDocumentoMagazzino({
      poloId,
      storagePath: prep.dati.path,
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      sha256,
    });
    if (!esito.ok) throw new Error(esito.errore);
  }

  async function deposita(scelti: File[]) {
    setErrore(null);
    setMessaggio(null);
    setInCorso(true);
    let fatti = 0;
    try {
      for (const [i, f] of scelti.entries()) {
        setAvanzamento(
          scelti.length > 1 ? `Carico ${i + 1} di ${scelti.length}: ${f.name}` : `Carico ${f.name}…`,
        );
        await depositaUno(f);
        fatti++;
      }
      setMessaggio(
        fatti === 1 ? "Documento depositato nel magazzino." : `${fatti} documenti depositati nel magazzino.`,
      );
      router.refresh();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Caricamento fallito.");
    } finally {
      setAvanzamento(null);
      setInCorso(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function scarica(d: DocumentoMagazzino) {
    setErrore(null);
    const esito = await urlFirmato("magazzino", d.storage_path);
    if (!esito.ok) {
      setErrore(esito.errore);
      return;
    }
    // URL firmato a scadenza breve e con download forzato: nessun file del
    // magazzino è raggiungibile senza passare da qui.
    window.location.href = esito.dati.url;
  }

  async function elimina(d: DocumentoMagazzino) {
    const conferma = await chiedi({
      titolo: `Eliminare "${d.file_name}" dal magazzino?`,
      descrizione:
        "Il documento sparisce per tutto il gruppo. Il magazzino non è un archivio certificato: se serve ancora, va depositato di nuovo.",
      testoConferma: "Elimina",
    });
    if (!conferma) return;
    setErrore(null);
    setMessaggio(null);
    const esito = await eliminaDocumentoMagazzino(d.id);
    if (!esito.ok) {
      setErrore(esito.errore);
      return;
    }
    setMessaggio("Documento eliminato.");
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Magazzino documenti</h2>
            {documenti.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {documenti.length} {documenti.length === 1 ? "documento" : "documenti"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Materiali di servizio del gruppo: moduli, guide, immagini, riferimenti. Si depositano,
            si scaricano e si eliminano liberamente — non appartengono a un progetto.
          </p>
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={inCorso}
          className="tt-btn bg-tt-ink px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
        >
          {inCorso ? "Carico…" : "Deposita documento"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCETTATI}
          className="hidden"
          onChange={(e) => {
            const scelti = Array.from(e.target.files ?? []);
            if (scelti.length) void deposita(scelti);
          }}
        />
      </div>

      {avanzamento && <p className="text-xs text-slate-500">{avanzamento}</p>}
      {errore && <p className="text-sm text-red-600">{errore}</p>}
      {messaggio && <p className="text-sm text-emerald-700">{messaggio}</p>}

      {documenti.length === 0 ? (
        <p className="tt-card-piccola p-6 text-sm text-slate-500">
          Magazzino vuoto. Deposita il primo documento.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden tt-card-piccola">
          {documenti.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-5 py-3.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.file_name}</span>
              <span className="text-xs text-slate-400">{peso(d.size_bytes)}</span>
              <span className="text-xs text-slate-400">
                {new Date(d.creato_at).toLocaleDateString("it-IT")}
                {d.caricato_da_nome ? ` · ${d.caricato_da_nome}` : ""}
              </span>
              <button
                onClick={() => void scarica(d)}
                className="text-xs font-medium text-tt-blue hover:underline"
              >
                Scarica
              </button>
              <button
                onClick={() => void elimina(d)}
                className="text-xs font-medium text-slate-400 hover:text-red-600"
              >
                Elimina
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialogo}
    </section>
  );
}
