"use client";

import { useEffect } from "react";

/**
 * Rende effettiva la scelta "non ricordarmi" fatta al login: quando il flag
 * `tt_ricordami` è "0", alla chiusura della scheda/browser la sessione
 * locale viene rimossa (signOut scope local), così al riavvio il dispositivo
 * non trova più l'accesso ricordato.
 *
 * Il cookie di sessione è HttpOnly: il client Supabase del browser non può
 * cancellarlo (document.cookie non tocca un cookie HttpOnly). Serve un
 * fetch al server con keepalive, l'unico modo che sopravvive alla chiusura
 * della pagina — una Server Action normale verrebbe interrotta a metà.
 *
 * Best-effort: se il browser si chiude in modo anomalo (crash, perdita di
 * rete) il logout potrebbe non scattare — è il limite del workaround, dato
 * che @supabase/ssr imposta comunque un cookie a lunga durata.
 */
export default function ControlloRicordami() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem("tt_ricordami") !== "0") return;

    const esci = () => {
      void fetch("/api/uscita-locale", { method: "POST", keepalive: true });
    };
    window.addEventListener("pagehide", esci);
    window.addEventListener("beforeunload", esci);
    return () => {
      window.removeEventListener("pagehide", esci);
      window.removeEventListener("beforeunload", esci);
    };
  }, []);

  return null;
}
