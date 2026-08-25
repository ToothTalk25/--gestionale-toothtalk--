"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import { preparaUpload, registraVersione } from "@/app/actions";
import { IconaCarica, IconaSpinner } from "@/components/icone-azioni";
import type { Archivio, DeliverableKind } from "@/lib/types";

type Fase = "idle" | "hash" | "upload" | "registro" | "fatto" | "errore";

/** Chiavi di storage: solo caratteri sicuri, il nome vero resta nel DB. */
function sanifica(nome: string) {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

/** L'SDK di Supabase Storage restituisce messaggi in inglese: qui i più
 *  comuni diventano italiano, il resto è nascosto dietro un avviso generico
 *  (mai un testo tecnico grezzo mostrato a chi carica). */
function traduciErroreStorage(messaggio: string): string {
  const m = messaggio.toLowerCase();
  if (m.includes("already exists")) return "Un file con lo stesso nome esiste già. Riprova.";
  if (m.includes("payload too large") || m.includes("exceeded the maximum")) {
    return "Il file è troppo grande.";
  }
  if (m.includes("failed to fetch") || m.includes("network")) {
    return "Connessione assente o instabile. Controlla la rete e riprova.";
  }
  return "Caricamento non riuscito. Riprova, o contatta l'assistenza se il problema persiste.";
}

export type UploadDeliverableHandle = {
  handleFile: (file: File) => void;
};

const UploadDeliverable = forwardRef<UploadDeliverableHandle, {
  taskId: string;
  kind: DeliverableKind;
  isAdmin: boolean;
  locked: boolean;
  esisteOriginale?: boolean;
  archivio?: Archivio;
  etichetta?: string;
  accept?: string;
  onCaricato?: (versionId: string) => void | Promise<void>;
  children?: React.ReactNode;
  /** true nelle card grandi (Materiali di lavorazione): contenuto centrato e area estesa. */
  cardIntera?: boolean;
}>(function UploadDeliverable({
  taskId,
  kind,
  isAdmin,
  locked,
  esisteOriginale = false,
  archivio = "lavorazione",
  etichetta,
  accept,
  onCaricato,
  children,
  cardIntera = false,
}, ref) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const inCorso = useRef(false);
  const [fase, setFase] = useState<Fase>("idle");
  const [progresso, setProgresso] = useState(0);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  // Chi ha accesso globale deposita sempre versioni derivate: la RLS impedisce di
  // scrivere un "originale", così non può fabbricare un deposito a nome
  // del gruppo né sostituire quella vera.
  const origin = isAdmin ? "admin_edit" : "originale";
  const bucket = isAdmin ? "revisioni" : archivio === "finale" ? "finali" : "originali";

  const bloccato = !isAdmin && locked;

  async function carica(file: File) {
    if (inCorso.current) return; // niente doppio upload in parallelo sullo stesso slot
    inCorso.current = true;
    setMessaggio(null);
    try {
      setFase("hash");
      setProgresso(0);
      const sha = await sha256File(file, setProgresso);

      const prep = await preparaUpload(taskId, kind);
      if (!prep.ok) throw new Error(prep.errore);

      const path = `${prep.dati.prefix}${crypto.randomUUID()}__${sanifica(file.name)}`;

      setFase("upload");
      const supabase = supabaseBrowser();
      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        // upsert:false è obbligatorio: sui bucket 'originali' e 'finali' non
        // esiste alcuna policy di UPDATE, quindi un upsert verrebbe respinto.
        upsert: false,
        contentType: file.type || "application/octet-stream",
      });
      if (error) throw new Error(traduciErroreStorage(error.message));

      setFase("registro");
      const esito = await registraVersione({
        taskId,
        deliverableId: prep.dati.deliverableId,
        origin,
        archivio,
        storagePath: path,
        fileName: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
        sha256: sha,
      });
      if (!esito.ok) throw new Error(esito.errore);

      setFase("fatto");

      await onCaricato?.(esito.dati.versionId);
      router.refresh();
    } catch (e) {
      setFase("errore");
      // I punti sopra lanciano già testo in italiano (server action, hash,
      // storage); un errore JavaScript imprevisto (bug, rete interrotta a
      // metà) non lo è: meglio un avviso generico che un testo tecnico.
      const testoConosciuto = e instanceof Error && /[àèéìòù]|[.!?]$/.test(e.message);
      setMessaggio(testoConosciuto ? (e as Error).message : "Caricamento non riuscito. Riprova.");
    } finally {
      inCorso.current = false;
      if (input.current) input.current.value = "";
    }
  }

  useImperativeHandle(ref, () => ({ handleFile: carica }));

  if (bloccato) {
    return <span className="text-xs text-slate-400">Caricamento bloccato</span>;
  }

  const base = etichetta ?? (isAdmin ? "Carica versione editata" : "Carica file");
  const baseCorto = etichetta ?? (isAdmin ? "Carica versione" : "Carica file");
  const etichette: Record<Fase, string> = {
    idle: base,
    hash: `Calcolo impronta ${Math.round(progresso * 100)}%`,
    upload: "Caricamento…",
    registro: "Sigillo in corso…",
    fatto: "Sostituisci",
    errore: "Riprova",
  };
  const etichetteCorte: Record<Fase, string> = {
    idle: baseCorto,
    hash: `Impronta ${Math.round(progresso * 100)}%`,
    upload: "Caricamento…",
    registro: "Sigillo…",
    fatto: "Sostituisci",
    errore: "Riprova",
  };

  const occupato = fase === "hash" || fase === "upload" || fase === "registro";

  const controlli = (
    <div className="text-center">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void carica(f);
        }}
      />
      <button
        onClick={() => input.current?.click()}
        disabled={occupato}
        title={etichette[fase]}
        aria-label={etichette[fase]}
        className={`tt-btn text-white disabled:opacity-60 ${
          archivio === "finale" ? "bg-tt-ink" : "bg-tt-blue"
        } ${cardIntera ? "flex items-center justify-center p-2" : "whitespace-nowrap px-3 py-1.5 text-xs"}`}
      >
        {cardIntera ? (
          occupato ? <IconaSpinner /> : <IconaCarica />
        ) : (
          <>
            <span className="sm:hidden">{etichetteCorte[fase]}</span>
            <span className="hidden sm:inline">{etichette[fase]}</span>
          </>
        )}
      </button>
      {isAdmin && !esisteOriginale && fase === "idle" && archivio === "lavorazione" && (
        <p className="mx-auto mt-1.5 max-w-[11rem] text-[11px] leading-tight text-amber-600">
          Nessun materiale depositato dal gruppo.
        </p>
      )}

      {messaggio && (
        <p
          className={`mx-auto mt-1.5 max-w-xs text-xs ${
            fase === "errore" ? "text-red-600" : "text-slate-500"
          }`}
        >
          {messaggio}
        </p>
      )}
    </div>
  );

  // Il rilascio drag&drop è sempre gestito dal contenitore esterno tramite
  // il ref (handleFile): questo componente non ha mai una propria zona di
  // drop, per evitare due aree attive sovrapposte di dimensioni diverse.
  //
  // Nelle card grandi (cardIntera) l'icona/contatore sta sopra, come primo
  // elemento visivo della card vuota, e il pulsante con le note sotto: lo
  // stesso ordine "icona → azione" delle altre card vuote (Google Doc).
  return cardIntera ? (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="flex min-h-[42px] flex-col items-center justify-center sm:min-h-[46px]">
        {children}
      </div>
      {controlli}
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2 text-center">
      {controlli}
      {children}
    </div>
  );
});

export default UploadDeliverable;
