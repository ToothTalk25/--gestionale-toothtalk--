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
  const refMobile = useRef<UploadDeliverableHandle>(null);
  const refDesktop = useRef<UploadDeliverableHandle>(null);
  const [dragOver, setDragOver] = useState(false);

  const droppabile = !isGoogleDoc && !mancaNumeroVideo;

  function consegna(file: File) {
    // Su mobile il blocco compatto è quello visibile, su desktop quello
    // quadrato: scegli il ref del viewport corrente (entrambi sono montati,
    // solo uno è visibile via CSS).
    const mobile = typeof window !== "undefined" && !window.matchMedia("(min-width: 640px)").matches;
    const target = mobile ? refMobile.current : refDesktop.current;
    target?.handleFile(file);
  }

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
              if (f) consegna(f);
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
      {/* ================= MOBILE: card compatta a una colonna ================= */}
      <div className="flex flex-col items-start gap-1.5 sm:hidden">
        <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
        <div className="flex w-full items-start gap-2">
          {/* Marcatore piccolo sotto il titolo, solo per gli slot di upload
              (non per i Google Doc, dove tutto va a destra): "+" se vuoto,
              il numero se ci sono già file, come nella card desktop. */}
          {!isGoogleDoc && !mancaNumeroVideo && (
            <span className="shrink-0 pt-0.5 text-base font-light leading-none text-slate-300" aria-hidden>
              {versioni.length > 0 ? versioni.length : "+"}
            </span>
          )}
          <div className="ml-auto">
            <Contenuto
              ref={refMobile}
              isGoogleDoc={isGoogleDoc}
              googleDocUrl={googleDocUrl}
              mancaNumeroVideo={mancaNumeroVideo}
              versioni={versioni}
              taskId={taskId}
              kind={kind}
              isAdmin={isAdmin}
              locked={locked}
              accetta={accetta}
              compatto
            />
          </div>
        </div>
      </div>

      {/* ================= DESKTOP: card quadrata invariata ================= */}
      <div className="hidden sm:block">
        <h3 className="pt-2 text-base font-semibold text-slate-700 text-center">{label}</h3>
        <div className="flex-1 flex items-center justify-center pb-2">
          <Contenuto
            ref={refDesktop}
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
      </div>

      {versioni.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto border-t border-slate-100 pt-2">
          <VersionList taskId={taskId} versioni={versioni} nomi={nomi} deliverableId={deliverableId} />
        </div>
      )}
    </div>
  );
}

/** Blocco azione/stato, condiviso fra i due layout (mobile compatto / desktop). */
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
  compatto = false,
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
  compatto?: boolean;
}) {
  if (isGoogleDoc) {
    return (
      <GoogleDocCard
        taskId={taskId}
        kind={kind}
        googleDocUrl={googleDocUrl}
        isAdmin={isAdmin}
        compatto={compatto}
      />
    );
  }
  if (mancaNumeroVideo) {
    return <p className="text-xs text-amber-700">Prima assegna un numero video.</p>;
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
        cardIntera={!compatto}
      >
        {compatto ? (
          <span className="text-xs text-slate-400">
            {versioni.length === 1 ? "1 file caricato" : `${versioni.length} file caricati`}
          </span>
        ) : (
          <>
            <div className="text-4xl mb-1 font-semibold text-center">{versioni.length}</div>
            <p className="text-[10px] text-slate-400 text-center">
              {versioni.length === 1 ? "file caricato" : "file caricati"}
            </p>
          </>
        )}
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
      cardIntera={!compatto}
    >
      {!compatto && <div className="mb-2 text-4xl text-slate-300 font-light text-center">+</div>}
    </UploadDeliverable>
  );
}
