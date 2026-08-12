import Link from "next/link";
import { requireSession } from "@/lib/auth";
import MenuUtente from "@/components/MenuUtente";
import BannerConsenso from "@/components/BannerConsenso";
import NavLink from "@/components/NavLink";
import { PoloAttivoProvider } from "@/components/PoloAttivoContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, poli, isAdmin } = await requireSession();

  return (
    <PoloAttivoProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8">
            <Link href="/dashboard" className="shrink-0">
              <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-6 w-auto" />
            </Link>

            <nav className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              {poli.map((p) => (
                <NavLink key={p.id} href={`/polo/${p.id}`} activePrefix={`/polo/${p.id}`} poloId={p.id}>
                  {p.nome}
                </NavLink>
              ))}
              {isAdmin && (
                <>
                  <NavLink href="/revisione" activePrefix="/revisione">
                    Video da rivedere
                  </NavLink>
                  <NavLink href="/admin" activePrefix="/admin">
                    Registro
                  </NavLink>
                </>
              )}
            </nav>

            {/*
              Nessuna etichetta di ruolo accanto al nome: la differenza fra chi ha
              accesso globale e chi no si vede dalle voci di menu disponibili
              (es. "Registro globale"), non da un titolo scritto addosso alla persona.
            */}
            <div className="ml-auto flex items-center">
              <MenuUtente profile={profile} isAdmin={isAdmin} />
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
        </main>

        <footer className="border-t border-slate-100 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-xs text-slate-400">
            <span>
              ToothTalk<sup className="ml-0.5 align-super text-[8px]">™</sup> —
              progetto di divulgazione odontoiatrica
            </span>
            <Link href="/privacy" className="hover:text-slate-600">
              Privacy e cookie
            </Link>
          </div>
        </footer>

        <BannerConsenso />
      </div>
    </PoloAttivoProvider>
  );
}
