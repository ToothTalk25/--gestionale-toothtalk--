import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth";
import MenuUtente from "@/components/MenuUtente";
import BannerConsenso from "@/components/BannerConsenso";
import NavLink from "@/components/NavLink";
import { PoloAttivoProvider } from "@/components/PoloAttivoContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, poli, isAdmin } = await requireSession();

  // --- Blocco accesso progetti finché l'accordo non è completo ---------
  // Quattro condizioni, TUTTE necessarie per i Collaboratori:
  //   1. accordo caricato (accordo_path)
  //   2. spunta "ho letto e compreso" (accordo_letto_confermato)
  //   3. verifica IA = 'ok' (accordo_verificato)
  //   4. approvazione manuale del Titolare (accordo_approvato_admin_at)
  // L'admin (isAdmin) non è mai soggetto al blocco. Chi è bloccato può
  // restare SOLO su /profilo (dove carica/gestisce l'accordo): tutto il
  // resto viene rimandato lì. Il redirect esclude esplicitamente /profilo
  // per evitare un loop infinito (il layout gira anche per /profilo).
  const pathname = (await headers()).get("x-pathname") ?? "";
  const accordoCompleto =
    isAdmin ||
    (!!profile.accordo_path &&
      profile.accordo_letto_confermato &&
      profile.accordo_verificato === "ok" &&
      !!profile.accordo_approvato_admin_at);
  if (!accordoCompleto && pathname !== "/profilo") {
    redirect("/profilo");
  }

  return (
    <PoloAttivoProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-x-3 gap-y-2 px-4 py-3 md:gap-x-6 md:px-8">
            <Link href="/dashboard" className="shrink-0">
              <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-6 w-auto" />
            </Link>

            <nav className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap text-sm text-slate-600 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {poli.map((p) => (
                <NavLink key={p.id} href={`/polo/${p.id}`} activePrefix={`/polo/${p.id}`} poloId={p.id}>
                  {p.nome}
                </NavLink>
              ))}
            </nav>

            {/*
              Nessuna etichetta di ruolo accanto al nome: la differenza fra chi ha
              accesso globale e chi no si vede dalle voci di menu disponibili
              (es. "Registro globale"), non da un titolo scritto addosso alla persona.
            */}
            <div className="ml-auto flex shrink-0 items-center">
              <MenuUtente profile={profile} isAdmin={isAdmin} />
            </div>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-4 md:py-8">{children}</div>
        </main>

        <footer className="border-t border-slate-100 py-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
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
