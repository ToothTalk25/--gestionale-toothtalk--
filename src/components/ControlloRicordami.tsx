"use client";

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Rende effettiva la scelta "non ricordarmi" fatta al login: quando il flag
 * `tt_ricordami` è "0", alla chiusura della scheda/browser la sessione
 * locale viene rimossa (signOut scope local), così al riavvio il dispositivo
 * non trova più l'accesso ricordato.
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
      void supabaseBrowser().auth.signOut({ scope: "local" });
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
