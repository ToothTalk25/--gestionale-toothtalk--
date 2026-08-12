"use client";

import { useEffect } from "react";

/** Registra il service worker minimo, richiesto da Chrome per mostrare l'icona "Installa app". */
export default function RegistraServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
