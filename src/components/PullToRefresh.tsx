"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Oltre questa distanza di trascinamento il rilascio aggiorna la pagina. */
const SOGLIA_PX = 70;
/** Oltre questa, il dito non "tira" più: evita un indicatore che scappa via. */
const MASSIMO_PX = 110;

/**
 * Pull-to-refresh per mobile: trascinando verso il basso da cima pagina
 * (scrollY 0) compare un indicatore che segue il dito; superata la soglia,
 * al rilascio la pagina si aggiorna (router.refresh(), non un reload pieno —
 * niente flash bianco, dati freschi dal server).
 *
 * globals.css disattiva apposta il rimbalzo nativo del browser
 * (overscroll-behavior-y: none, per il look "da app"): senza quello, qui
 * non c'era alcun modo di aggiornare tirando dall'alto, un gesto che su
 * mobile ci si aspetta comunque.
 */
export default function PullToRefresh() {
  const router = useRouter();
  const [distanza, setDistanza] = useState(0);
  const [aggiornando, setAggiornando] = useState(false);
  const startYRef = useRef<number | null>(null);
  const tirandoRef = useRef(false);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (window.scrollY > 0 || aggiornando) return;
      startYRef.current = e.touches[0].clientY;
      tirandoRef.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null || aggiornando) return;
      const dy = e.touches[0].clientY - startYRef.current;
      if (dy <= 0) {
        // Il dito è tornato su (o non si sta tirando verso il basso):
        // niente indicatore, e si lascia scorrere la pagina normalmente.
        if (tirandoRef.current) {
          tirandoRef.current = false;
          setDistanza(0);
        }
        return;
      }
      // scrollY torna >0 se nel frattempo la pagina ha scrollato (es. rimbalzo
      // residuo): da lì in poi il gesto non è più un pull-to-refresh.
      if (window.scrollY > 0) return;
      tirandoRef.current = true;
      e.preventDefault();
      setDistanza(Math.min(dy, MASSIMO_PX));
    }

    function onTouchEnd() {
      if (tirandoRef.current && distanza >= SOGLIA_PX) {
        setAggiornando(true);
        router.refresh();
        // router.refresh() non espone un callback di completamento: un
        // breve spinner fisso è la semplificazione comune per questo gesto.
        window.setTimeout(() => {
          setAggiornando(false);
          setDistanza(0);
        }, 700);
      } else {
        setDistanza(0);
      }
      startYRef.current = null;
      tirandoRef.current = false;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanza, aggiornando]);

  const visibile = distanza > 0 || aggiornando;
  const progresso = Math.min(distanza / SOGLIA_PX, 1);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center transition-opacity"
      style={{
        top: "calc(0.5rem + env(safe-area-inset-top))",
        opacity: visibile ? 1 : 0,
        transform: `translateY(${aggiornando ? 0 : Math.max(distanza - 40, -20)}px)`,
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-[0_4px_16px_-4px_rgba(23,40,55,.35)]">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={`text-tt-blue ${aggiornando ? "animate-spin" : ""}`}
          style={aggiornando ? undefined : { transform: `rotate(${progresso * 360}deg)` }}
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </svg>
      </div>
    </div>
  );
}
