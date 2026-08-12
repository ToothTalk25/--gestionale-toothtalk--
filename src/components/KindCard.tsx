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
      className={`group aspect-square rounded-lg p-2 ring-1 flex flex-col transition-colors ${
        dragOver ? "ring-2 ring-tt-blue bg-tt-blue/5" : "bg-white ring-black/5"
      }`}
    >
      <h3 className="pt-2 text-base font-semibold text-slate-700 text-center">{label}</h3>

      <div className="flex-1 flex items-center justify-center pb-2">
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
            <div className="text-4xl mb-1 font-bold">{versioni.length}</div>
            <p className="text-[10px] text-slate-400">
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
            <div className="mb-2 text-4xl text-slate-300 font-light">+</div>
          </UploadDeliverable>
        )}
      </div>

      {versioni.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto border-t border-slate-100 pt-2">
          <VersionList taskId={taskId} versioni={versioni} nomi={nomi} deliverableId={deliverableId} />
        </div>
      )}
    </div>
  );
}
