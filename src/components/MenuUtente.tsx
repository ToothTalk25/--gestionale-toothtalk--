"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
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
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setAperto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aperto}
        className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50"
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
          className="absolute right-0 z-10 mt-1 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/5"
        >
          {/* Voci comuni a tutti: Progetti e Profilo. Per chi ha accesso
              globale si aggiungono anche le voci di amministrazione, così
              tutto è raggiungibile anche dal menu del profilo. */}
          <Link
            href="/dashboard"
            onClick={() => setAperto(false)}
            role="menuitem"
            className={pathname === "/dashboard" ? vociAttive : vociInattive}
          >
            Progetti
          </Link>
          <Link
            href="/profilo"
            onClick={() => setAperto(false)}
            role="menuitem"
            className={pathname === "/profilo" ? vociAttive : vociInattive}
          >
            Profilo
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
