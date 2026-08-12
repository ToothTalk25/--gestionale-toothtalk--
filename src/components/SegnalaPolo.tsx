"use client";

import { useSegnalaPoloAttivo } from "@/components/PoloAttivoContext";

/** Da mettere nelle pagine di progetto: tiene evidenziato il gruppo giusto nella barra in alto. */
export default function SegnalaPolo({ poloId }: { poloId: string }) {
  useSegnalaPoloAttivo(poloId);
  return null;
}
