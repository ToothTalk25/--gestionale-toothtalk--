"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { richiediEsportazioneDrive } from "@/app/actions-pacchetto";
import type { EsportazioneDriveRow, EsportazioneDriveStato } from "@/lib/types";

/**
 * Badge con lo stato della copia su Google Drive del pacchetto.
 *
 * Mentre l'esportazione è "in coda" o "in corso" guarda la riga ogni
 * pochi secondi: si aggiorna da sola quando la Edge Function finisce.
 * Il bottone "Riprova" richiama la RPC che riporta la riga a 'da_fare'.
 */
export default function EsportazioneDrive({
  pacchettoId,
  riga,
}: {
  pacchettoId: string;
  riga: EsportazioneDriveRow | null;
}) {
  const router = useRouter();
  const [stato, setStato] = useState<EsportazioneDriveStato | null>(riga?.stato ?? null);
  const [url, setUrl] = useState<string | null>(riga?.cartella_drive_url ?? null);
  const [errore, setErrore] = useState<string | null>(riga?.ultimo_errore ?? null);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    if (stato !== "da_fare" && stato !== "in_corso") return;
    const t = setInterval(async () => {
      const { data } = await supabaseBrowser()
        .from("esportazioni_drive")
        .select("stato, cartella_drive_url, ultimo_errore")
        .eq("pacchetto_id", pacchettoId)
        .maybeSingle();
      if (data) {
        setStato(data.stato as EsportazioneDriveStato);
        setUrl(data.cartella_drive_url);
        setErrore(data.ultimo_errore);
      }
    }, 8000);
    return () => clearInterval(t);
  }, [stato, pacchettoId]);

  async function riprova() {
    setInCorso(true);
    const esito = await richiediEsportazioneDrive(pacchettoId);
    setInCorso(false);
    if (esito.ok) {
      setStato("da_fare");
      setErrore(null);
      router.refresh();
    }
  }

  // Nessuna esportazione registrata: la riga nasce solo alla spedizione PEC.
  if (!stato) return null;

  if (stato === "fatto") {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        Drive: ✅ copiato{" "}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-emerald-600"
          >
            apri la cartella
          </a>
        )}
      </p>
    );
  }

  if (stato === "errore") {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
        Drive: ⚠️ esportazione non riuscita{errore ? ` — ${errore}` : ""}{" "}
        <button
          onClick={riprova}
          disabled={inCorso}
          className="font-medium underline disabled:opacity-50"
        >
          {inCorso ? "riprovo…" : "Riprova"}
        </button>
      </p>
    );
  }

  if (stato === "in_corso") {
    return (
      <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Drive: in corso…
      </p>
    );
  }

  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
      Drive: in coda per la copia
    </p>
  );
}
