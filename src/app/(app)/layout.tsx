import Link from "next/link";
import { requireSession } from "@/lib/auth";
import MenuUtente from "@/components/MenuUtente";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, poli, isAdmin } = await requireSession();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="shrink-0">
            <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-6 w-auto" />
          </Link>

          <nav className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            {poli.map((p) => (
              <Link key={p.id} href={`/polo/${p.id}`} className="hover:text-tt-ink">
                {p.nome}
              </Link>
            ))}
            {isAdmin && (
              <>
                <Link href="/revisione" className="font-medium text-tt-blue">
                  Video da rivedere
                </Link>
                <Link href="/admin" className="hover:text-tt-ink">
                  Registro
                </Link>
              </>
            )}
          </nav>

          {/*
            Nessuna etichetta di ruolo accanto al nome: la differenza fra chi ha
            accesso globale e chi no si vede dalle voci di menu disponibili
            (es. "Registro globale"), non da un titolo scritto addosso alla persona.
          */}
          <div className="ml-auto flex items-center">
            <MenuUtente profile={profile} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
