"use client";

import { useEffect, useState } from "react";
import { registraPush } from "@/app/actions-supporto";

function base64UrlAUint8Array(base64Url: string): BufferSource {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))) as BufferSource;
}

/**
 * Banner per attivare le notifiche push su questo dispositivo (avviso
 * quando arriva una nuova domanda dalla sezione "Domande"). Su iPhone
 * funziona solo se il gestionale è già installato come app (Home Screen):
 * Safari da tab normale non supporta le push — lo spieghiamo se il
 * permesso viene negato o non richiedibile.
 */
export default function AttivaNotifichePush() {
  const [stato, setStato] = useState<"verifica" | "non-supportato" | "da-attivare" | "attivo" | "negato">(
    "verifica",
  );
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let annullato = false;
    async function controlla() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!annullato) setStato("non-supportato");
        return;
      }
      if (Notification.permission === "denied") {
        if (!annullato) setStato("negato");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!annullato) setStato(sub ? "attivo" : "da-attivare");
    }
    controlla();
    return () => {
      annullato = true;
    };
  }, []);

  async function attiva() {
    setErrore(null);
    try {
      const permesso = await Notification.requestPermission();
      if (permesso !== "granted") {
        setStato("negato");
        return;
      }
      const chiavePubblica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!chiavePubblica) throw new Error("Notifiche non configurate sul server.");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlAUint8Array(chiavePubblica),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error("Iscrizione push incompleta.");
      }
      const res = await registraPush({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      if (!res.ok) throw new Error(res.errore);
      setStato("attivo");
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Attivazione fallita.");
    }
  }

  if (stato === "verifica" || stato === "attivo" || stato === "non-supportato") return null;

  return (
    <div className="tt-card flex flex-wrap items-center justify-between gap-3 border border-tt-blue-100 bg-tt-blue-50 p-4">
      <div>
        <p className="text-sm font-medium text-slate-800">Notifiche push non attive su questo dispositivo</p>
        <p className="mt-0.5 text-xs text-slate-600">
          {stato === "negato"
            ? "Le notifiche sono bloccate per questo sito. Su iPhone: assicurati di aver aperto il gestionale come app installata (Home Screen), poi riabilitale nelle impostazioni del dispositivo."
            : "Ricevi un avviso su questo dispositivo appena un collaboratore scrive una domanda."}
        </p>
        {errore && <p className="mt-1 text-xs text-red-600">{errore}</p>}
      </div>
      {stato === "da-attivare" && (
        <button onClick={attiva} className="tt-btn shrink-0 bg-tt-blue px-4 py-2 text-sm text-white">
          Attiva notifiche
        </button>
      )}
    </div>
  );
}
