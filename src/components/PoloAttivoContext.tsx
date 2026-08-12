"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Le pagine di progetto (/task/[taskId]) non sono annidate sotto
 * /polo/[poloId]/..., quindi il NavLink in alto non le riconosce dal solo
 * pathname. Questo contesto lascia a quelle pagine il compito di segnalare
 * "sono dentro il gruppo X", così il link del gruppo in alto resta
 * evidenziato anche quando si è dentro un singolo progetto.
 */
const PoloAttivoContext = createContext<{
  poloId: string | null;
  setPoloId: (id: string | null) => void;
}>({ poloId: null, setPoloId: () => {} });

export function PoloAttivoProvider({ children }: { children: React.ReactNode }) {
  const [poloId, setPoloId] = useState<string | null>(null);
  return (
    <PoloAttivoContext.Provider value={{ poloId, setPoloId }}>
      {children}
    </PoloAttivoContext.Provider>
  );
}

/** Da chiamare nelle pagine di progetto per segnalare il gruppo di appartenenza. */
export function useSegnalaPoloAttivo(poloId: string | null) {
  const { setPoloId } = useContext(PoloAttivoContext);
  useEffect(() => {
    setPoloId(poloId);
    return () => setPoloId(null);
  }, [poloId, setPoloId]);
}

export function usePoloAttivo() {
  return useContext(PoloAttivoContext).poloId;
}
