"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePoloAttivo } from "@/components/PoloAttivoContext";

/**
 * Link di navigazione con stato attivo: quando sei nella sezione, il link
 * diventa blu; le altre voci restano normali.
 *
 * `poloId`, se passato, tiene il link evidenziato anche quando si è dentro
 * una pagina di progetto di quel gruppo (fuori da /polo/[poloId]/..., vedi
 * PoloAttivoContext).
 */
export default function NavLink({
  href,
  children,
  activePrefix,
  poloId,
}: {
  href: string;
  children: React.ReactNode;
  activePrefix?: string;
  poloId?: string;
}) {
  const pathname = usePathname();
  const poloAttivo = usePoloAttivo();
  const attivo = activePrefix
    ? pathname.startsWith(activePrefix) || (!!poloId && poloId === poloAttivo)
    : pathname === href;

  return (
    <Link
      href={href}
      className={
        attivo
          ? "shrink-0 rounded-lg bg-tt-blue-50 px-3 py-1.5 font-semibold text-tt-blue"
          : "shrink-0 rounded-lg px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-50 hover:text-tt-ink"
      }
    >
      {children}
    </Link>
  );
}
