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
          ? "rounded-md bg-tt-blue-50 px-2 py-0.5 font-medium text-tt-blue"
          : "rounded-md px-2 py-0.5 text-slate-600 hover:text-tt-ink hover:bg-slate-50"
      }
    >
      {children}
    </Link>
  );
}
