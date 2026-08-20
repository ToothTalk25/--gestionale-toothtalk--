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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 md:flex-nowrap md:gap-x-6 md:px-8">
            <Link href="/dashboard" className="order-1 shrink-0">
              <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-6 w-auto" />
            </Link>

            {/*
              Nessuna etichetta di ruolo accanto al nome: la differenza fra chi ha
              accesso globale e chi no si vede dalle voci di menu disponibili
              (es. "Registro globale"), non da un titolo scritto addosso alla persona.
            */}
            <div className="order-2 ml-auto flex shrink-0 items-center md:order-3">
              <MenuUtente profile={profile} isAdmin={isAdmin} />
            </div>

            {/*
              Su mobile i poli vanno a capo su una riga propria (niente più
              testo tagliato a bordo schermo dallo scroll orizzontale
              invisibile). Da tablet in su torna lo scorrimento orizzontale,
              c'è spazio per stare su una riga sola.
            */}
            <nav className="order-3 flex w-full flex-wrap items-center gap-2 text-sm text-slate-600 md:order-2 md:w-auto md:min-w-0 md:flex-1 md:flex-nowrap md:gap-3 md:overflow-x-auto md:whitespace-nowrap md:[-ms-overflow-style:none] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
              {poli.map((p) => (
                <NavLink key={p.id} href={`/polo/${p.id}`} activePrefix={`/polo/${p.id}`} poloId={p.id}>
                  {p.nome}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto max-w-6xl px-4 py-4 pb-28 md:py-8 sm:pb-8">{children}</div>
        </main>

        {/*
          Fisso a fondo schermo su mobile (l'utente lo vuole sempre visibile,
          non in fondo a uno scroll lunghissimo). Da "sm" in su torna nel
          normale flusso della pagina, come un footer qualsiasi.
        */}
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white py-3 sm:static sm:z-auto sm:py-4">
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
