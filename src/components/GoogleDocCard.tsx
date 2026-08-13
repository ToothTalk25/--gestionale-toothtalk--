"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { impostaGoogleDocUrl } from "@/app/actions";
import type { DeliverableKind } from "@/lib/types";

export default function GoogleDocCard({
  taskId,
  kind,
  googleDocUrl,
  isAdmin,
  compatto = false,
}: {
  taskId: string;
  kind: DeliverableKind;
  googleDocUrl: string | null;
  isAdmin: boolean;
  /** true nella card compatta mobile: tutto (icona, bottone, "Cambia link") va a destra e più piccolo. */
  compatto?: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(googleDocUrl ?? "");
  const [modifica, setModifica] = useState(false);
  const [pending, start] = useTransition();

  function salva() {
    start(async () => {
      await impostaGoogleDocUrl(taskId, kind, url || null);
      setModifica(false);
      router.refresh();
    });
  }

  if (modifica) {
    return (
      <div className="w-full space-y-1.5 text-center">
        <div className="mb-2 text-4xl text-slate-300">📄</div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/document/d/..."
          className="w-full rounded border border-slate-300 px-2 py-1 text-[11px]"
          autoFocus
        />
        <div className="flex justify-center gap-1">
          <button
            onClick={salva}
            disabled={pending}
            className="rounded-lg bg-tt-blue px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            Salva
          </button>
          <button
            onClick={() => setModifica(false)}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
          >
            Annulla
          </button>
        </div>
      </div>
    );
  }

  if (googleDocUrl) {
    return (
      <div className="text-center">
        <div className={compatto ? "mb-1 text-xl" : "mb-1 text-4xl"}>📄</div>
        <a
          href={googleDocUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg bg-tt-blue px-3 py-1.5 text-xs font-medium text-white"
        >
          Apri Google Doc ↗
        </a>
        {isAdmin && (
          <div className="flex justify-center">
            <button
              onClick={() => {
                setModifica(true);
                setUrl(googleDocUrl);
              }}
              className="mt-1 text-[10px] text-slate-400 underline hover:text-slate-600"
            >
              Cambia link
            </button>
          </div>
        )}
      </div>
    );
  }

  if (isAdmin) {
    return (
      <div className="text-center">
        <div className={compatto ? "mb-1 text-xl text-slate-300 font-light" : "mb-2 text-4xl text-slate-300 font-light"}>📄</div>
        <div className="flex justify-center">
          <button
            onClick={() => setModifica(true)}
            className="rounded-lg bg-tt-blue px-3 py-1.5 text-xs font-medium text-white"
          >
            + Collega Google Doc
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={compatto ? "text-right" : "text-center"}>
      <div className={compatto ? "mb-1 text-xl text-slate-300 font-light" : "mb-1 text-4xl text-slate-300 font-light"}>📄</div>
      <p className={compatto ? "max-w-[10rem] text-[10px] text-slate-400" : "px-2 text-[10px] text-slate-400"}>
        Nessun documento collegato
      </p>
    </div>
  );
}
