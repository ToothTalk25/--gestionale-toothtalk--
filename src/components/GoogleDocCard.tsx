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
}: {
  taskId: string;
  kind: DeliverableKind;
  googleDocUrl: string | null;
  isAdmin: boolean;
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

  if (!googleDocUrl && !isAdmin) return null;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2">
      {googleDocUrl ? (
        <>
          <a
            href={googleDocUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            📄 Apri Google Doc ↗
          </a>
          {isAdmin && !modifica && (
            <button
              onClick={() => { setModifica(true); setUrl(googleDocUrl); }}
              className="text-[10px] text-slate-400 underline hover:text-slate-600"
            >
              Cambia link
            </button>
          )}
        </>
      ) : isAdmin ? (
        <button
          onClick={() => setModifica(true)}
          className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
        >
          + Collega Google Doc
        </button>
      ) : null}

      {modifica && (
        <div className="w-full space-y-1.5">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://docs.google.com/document/d/..."
            className="w-full rounded border border-slate-300 px-2 py-1 text-[11px]"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={salva}
              disabled={pending}
              className="rounded bg-blue-600 px-2 py-0.5 text-[11px] text-white disabled:opacity-50"
            >
              Salva
            </button>
            <button
              onClick={() => setModifica(false)}
              className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
            >
              Annulla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
