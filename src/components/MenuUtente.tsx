"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { esci as esciServer } from "@/app/actions-auth";
import type { Profile } from "@/lib/types";
import FotoProfilo from "@/components/FotoProfilo";

/**
 * Menu utente nell'intestazione: avatar (foto o iniziali) + nome.
 * Aprendo la tendina: "Profilo" (pagina /profilo) ed "Esci".
 */
export default function MenuUtente({ profile, isAdmin }: { profile: Profile; isAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [aperto, setAperto] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const vociAttive = "block px-4 py-2 text-sm font-medium bg-tt-blue-50 text-tt-blue";
  const vociInattive = "block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50";

  useEffect(() => {
    function chiudi(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) {
        setAperto(false);
      }
    }
    document.addEventListener("mousedown", chiudi);
    return () => document.removeEventListener("mousedown", chiudi);
  }, []);

  const iniziali = (profile.full_name ?? profile.email)
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function esci() {
    // Logout esplicito: la scelta "ricordami" riparte da zero al prossimo login.
    window.localStorage.removeItem("tt_ricordami");
    await esciServer();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setAperto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aperto}
        className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm transition-colors hover:bg-slate-50"
      >
        {profile.foto_path ? (
          <FotoProfilo path={profile.foto_path} className="h-6 w-6 rounded-full object-cover" alt="" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-tt-blue text-[10px] font-semibold text-white">
            {iniziali}
          </span>
        )}
        <span className="hidden text-slate-600 min-[420px]:inline">{profile.full_name ?? profile.email}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`text-slate-400 transition-transform ${aperto ? "rotate-180" : ""}`}
        >
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {aperto && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-2xl border border-slate-100 bg-white py-1.5 shadow-[0_10px_30px_-8px_rgba(23,40,55,.22)]"
        >
          {/* Profilo come prima voce: è la sezione personale, poi il resto.
              "Video da rivedere" e "Registro" stanno solo qui, non nella
              barra in alto: la barra resta la navigazione tra i poli, gli
              strumenti di amministrazione vivono nella tendina personale. */}
          <Link
            href="/profilo"
            onClick={() => setAperto(false)}
            role="menuitem"
            className={pathname === "/profilo" ? vociAttive : vociInattive}
          >
            Profilo
          </Link>
          <Link
            href="/dashboard"
            onClick={() => setAperto(false)}
            role="menuitem"
            className={pathname === "/dashboard" ? vociAttive : vociInattive}
          >
            Progetti
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/revisione"
                onClick={() => setAperto(false)}
                role="menuitem"
                className={pathname === "/revisione" ? vociAttive : vociInattive}
              >
                Video da rivedere
              </Link>
              <Link
                href="/admin"
                onClick={() => setAperto(false)}
                role="menuitem"
                className={pathname === "/admin" ? vociAttive : vociInattive}
              >
                Registro
              </Link>
            </>
          )}
          <button
            onClick={esci}
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Esci
          </button>
        </div>
      )}
    </div>
  );
}
