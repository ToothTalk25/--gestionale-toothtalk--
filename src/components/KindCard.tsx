"use client";

import { useRef, useState } from "react";
import UploadDeliverable, { type UploadDeliverableHandle } from "@/components/UploadDeliverable";
import GoogleDocCard from "@/components/GoogleDocCard";
import VersionList from "@/components/VersionList";
import type { DeliverableKind, DeliverableVersion } from "@/lib/types";

/** Un'icona per tipo di materiale: lo stesso set di forme (video, immagine,
 *  documento) ovunque nel gestionale compaia quel tipo di file. */
function IconaKind({ kind }: { kind: DeliverableKind }) {
  const comuni = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "video_grezzo") {
    return <svg {...comuni}><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3" /></svg>;
  }
  if (kind === "immagini_montaggio" || kind === "thumbnail") {
    return <svg {...comuni}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>;
  }
  if (kind === "script" || kind === "descrizione") {
    return <svg {...comuni}><path d="M4 4h16v16H4z" stroke="none" /><path d="M6 4v16M6 8h12M6 12h12M6 16h8" /></svg>;
  }
  if (kind === "titolo_youtube") {
    return <svg {...comuni}><rect x="2" y="6" width="20" height="12" rx="3" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" /></svg>;
  }
  return <svg {...comuni}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>;
}

/**
 * Una card di "Materiali di lavorazione". Stessa forma (icona/etichetta in
 * cima, contenuto al centro) a ogni larghezza — su mobile la griglia passa
 * a 2 colonne e i testi si stringono, ma non è una card diversa: il
 * mockup usa la stessa card compatta sia su desktop sia su telefono.
 *
 * Il rilascio drag&drop è gestito qui, sulla card intera (stesso pattern
 * di Slot in PacchettoVideo): così l'area attiva coincide sempre con
 * quella visibile, senza dipendere dal layout interno di UploadDeliverable.
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
      className={`group flex flex-col rounded-2xl p-3 ring-1 transition-colors sm:p-4 sm:min-h-[150px] ${
        dragOver
          ? "ring-2 ring-tt-blue bg-tt-blue/5"
          : versioni.length > 0 || (isGoogleDoc && !!googleDocUrl)
            ? "bg-tt-blue-50 ring-tt-blue-100"
            : "bg-white ring-black/5"
      }`}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
        <span className="text-slate-400"><IconaKind kind={kind} /></span>
        <h3 className="text-[11px] font-semibold text-slate-700 sm:text-[12.5px]">{label}</h3>
        <Contenuto
          ref={ref}
          isGoogleDoc={isGoogleDoc}
          googleDocUrl={googleDocUrl}
          mancaNumeroVideo={mancaNumeroVideo}
          versioni={versioni}
          taskId={taskId}
          kind={kind}
          isAdmin={isAdmin}
          locked={locked}
          accetta={accetta}
        />
      </div>

      {versioni.length > 0 && (
        <div
          className={`mt-2 border-t border-slate-100 pt-2 ${
            versioni.length > 2 ? "max-h-40 overflow-y-auto" : ""
          }`}
        >
          <VersionList taskId={taskId} versioni={versioni} nomi={nomi} deliverableId={deliverableId} />
        </div>
      )}
    </div>
  );
}

/** Blocco azione/stato al centro della card. */
function Contenuto({
  ref,
  isGoogleDoc,
  googleDocUrl,
  mancaNumeroVideo,
  versioni,
  taskId,
  kind,
  isAdmin,
  locked,
  accetta,
}: {
  ref: React.RefObject<UploadDeliverableHandle | null>;
  isGoogleDoc: boolean;
  googleDocUrl: string | null;
  mancaNumeroVideo: boolean;
  versioni: DeliverableVersion[];
  taskId: string;
  kind: DeliverableKind;
  isAdmin: boolean;
  locked: boolean;
  accetta?: string;
}) {
  if (isGoogleDoc) {
    return (
      <GoogleDocCard
        taskId={taskId}
        kind={kind}
        googleDocUrl={googleDocUrl}
        isAdmin={isAdmin}
        compatto
      />
    );
  }
  if (mancaNumeroVideo) {
    return <p className="text-[10.5px] text-amber-700">Prima assegna un numero video.</p>;
  }
  if (versioni.length > 0) {
    return (
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
        <div className="text-center text-xl font-semibold text-tt-blue-600 sm:text-2xl">{versioni.length}</div>
        <p className="text-[10px] text-slate-400 text-center">
          {versioni.length === 1 ? "file caricato" : "file caricati"}
        </p>
      </UploadDeliverable>
    );
  }
  return (
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
      <div className="text-xl text-slate-300 font-light text-center sm:text-2xl">+</div>
    </UploadDeliverable>
  );
}
