import Link from "next/link";

/**
 * Freccia "torna indietro", minimale: su alcuni telefoni lo swipe dal bordo
 * per tornare alla pagina precedente non è disponibile o attivo di default,
 * quindi le pagine annidate (progetto, attestazione, verbale...) hanno
 * bisogno di un modo visibile per risalire, non solo del back del sistema
 * operativo. Solo icona (l'etichetta resta per lettori di schermo via
 * aria-label): il contesto — dove si torna — lo dà già il titolo sotto.
 * `no-print` perché nei documenti stampabili (attestazione, verbale) non
 * deve comparire sulla stampa.
 */
export default function TornaIndietro({
  href,
  etichetta,
}: {
  href: string;
  etichetta: string;
}) {
  return (
    <Link
      href={href}
      aria-label={etichetta}
      className="no-print -ml-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-tt-ink"
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
        <path
          d="M12.5 15.5 7 10l5.5-5.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
