"use client";

import { useEffect, useState } from "react";
import { urlFotoProfilo } from "@/app/actions-profilo";

/**
 * Mostra una foto dal bucket privato 'profili' usando un URL firmato (valido
 * un'ora). La firma la chiede al SERVER: i cookie di sessione sono HttpOnly,
 * quindi dal browser il client Supabase non vede la sessione, createSignedUrl
 * falliva sempre e la foto compariva come «—». Stesso motivo per cui non
 * appariva il banner di consenso (CONTESTO.md, voce 15).
 */
export default function FotoProfilo({
  path,
  className,
  alt = "",
}: {
  path: string;
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let attivo = true;
    urlFotoProfilo(path).then((r) => {
      if (attivo && r.ok) setUrl(r.url);
    });
    return () => {
      attivo = false;
    };
  }, [path]);

  if (!url) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  return <img src={url} alt={alt} className={className} />;
}
