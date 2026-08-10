"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Mostra una foto dal bucket privato 'profili' usando un URL firmato
 * (valido un'ora). Nel bucket privato l'URL pubblico non basta: serve
 * l'autenticazione.
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
    supabaseBrowser()
      .storage.from("profili")
      .createSignedUrl(path, 3600)
      .then(({ data, error }) => {
        if (attivo && !error && data) setUrl(data.signedUrl);
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
