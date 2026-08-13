"use client";

import { useRef, useState } from "react";
import UploadDeliverable, { type UploadDeliverableHandle } from "@/components/UploadDeliverable";
import GoogleDocCard from "@/components/GoogleDocCard";
import VersionList from "@/components/VersionList";
import type { DeliverableKind, DeliverableVersion } from "@/lib/types";

/**
 * Una card di "Materiali di lavorazione". Il rilascio drag&drop è gestito
 * qui, sulla card intera (stesso pattern di Slot in PacchettoVideo): così
 * l'area attiva coincide sempre con quella visibile, senza dipendere dal
 * layout interno di UploadDeliverable.
 */
export default function KindCard({
  taskId,
  kind,
  label,
  isAdmin,
  locked,
  isGoogleDoc,
  googleDocUrl,
  mancaNumeroVideo,
  versioni,
  deliverableId,
  accetta,
  nomi,
}: {
  taskId: string;
  kind: DeliverableKind;
  label: string;
  isAdmin: boolean;
  locked: boolean;
  isGoogleDoc: boolean;
  googleDocUrl: string | null;
  mancaNumeroVideo: boolean;
  versioni: DeliverableVersion[];
  deliverableId?: string;
  accetta?: string;
  nomi: Record<string, string>;
}) {
  const ref = useRef<UploadDeliverableHandle>(null);
  const [dragOver, setDragOver] = useState(false);

  const droppabile = !isGoogleDoc && !mancaNumeroVideo;

  return (
    <div
      onDragOver={
        droppabile
          ? (e) => {
              e.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={droppabile ? () => setDragOver(false) : undefined}
      onDrop={
        droppabile
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) ref.current?.handleFile(f);
            }
          : undefined
      }
      className={`group rounded-lg p-2 ring-1 flex flex-col transition-colors sm:aspect-square ${
        dragOver
          ? "ring-2 ring-tt-blue bg-tt-blue/5"
          : versioni.length > 0
            ? "bg-tt-blue-50 ring-tt-blue/20"
            : "bg-white ring-black/5"
      }`}
    >
      <div className="flex items-center gap-3 sm:block">
        {/* Su mobile l'area stato/azione sta a sinistra in una riga orizzontale:
            icona o contatore + etichetta leggibile. Da sm: torna verticale come oggi. */}
        <div className="flex-1 sm:flex-none sm:pt-2">
          <h3 className="text-base font-semibold text-slate-700 text-center sm:text-center">{label}</h3>
        </div>

        <div className="flex-1 sm:block sm:flex-1 sm:flex sm:items-center sm:justify-center sm:pb-2">
          {isGoogleDoc ? (
            <GoogleDocCard taskId={taskId} kind={kind} googleDocUrl={googleDocUrl} isAdmin={isAdmin} />
          ) : mancaNumeroVideo ? (
            <p className="text-xs text-amber-700 text-center px-2">
              Prima assegna un numero video.
            </p>
          ) : versioni.length > 0 ? (
            <UploadDeliverable
              ref={ref}
              taskId={taskId}
              kind={kind}
              isAdmin={isAdmin}
              locked={locked}
              esisteOriginale={versioni.some((v) => v.origin === "originale")}
              accept={accetta}
              cardIntera
            >
              <div className="text-4xl mb-1 font-bold text-center sm:text-center">{versioni.length}</div>
              <p className="text-[10px] text-slate-400 text-center sm:text-center">
                {versioni.length === 1 ? "file caricato" : "file caricati"}
              </p>
            </UploadDeliverable>
          ) : (
            <UploadDeliverable
              ref={ref}
              taskId={taskId}
              kind={kind}
              isAdmin={isAdmin}
              locked={locked}
              esisteOriginale={false}
              accept={accetta}
              cardIntera
            >
              <div className="mb-2 text-4xl text-slate-300 font-light text-center sm:text-center">+</div>
            </UploadDeliverable>
          )}
        </div>
      </div>

      {versioni.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto border-t border-slate-100 pt-2">
          <VersionList taskId={taskId} versioni={versioni} nomi={nomi} deliverableId={deliverableId} />
        </div>
      )}
    </div>
  );
}
