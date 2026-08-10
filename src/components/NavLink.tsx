"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Link di navigazione con stato attivo: quando sei nella sezione, il link
 * diventa blu; le altre voci restano normali.
 */
export default function NavLink({
  href,
  children,
  activePrefix,
}: {
  href: string;
  children: React.ReactNode;
  activePrefix?: string;
}) {
  const pathname = usePathname();
  const attivo = activePrefix ? pathname.startsWith(activePrefix) : pathname === href;

  return (
    <Link
      href={href}
      className={
        attivo ? "font-medium text-tt-blue" : "text-slate-600 hover:text-tt-ink"
      }
    >
      {children}
    </Link>
  );
}
