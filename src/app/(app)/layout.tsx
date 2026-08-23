import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth";
import MenuUtente from "@/components/MenuUtente";
import BannerConsenso from "@/components/BannerConsenso";
import NavLink from "@/components/NavLink";
import { PoloAttivoProvider } from "@/components/PoloAttivoContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, poli, isAdmin, soloConfermaUscita } = await requireSession();

  // Uscita con conferma Art. 9.4 pendente: chiunque entri nell'app mentre la
  // conferma è in attesa viene mandato alla pagina dedicata /uscita (fuori
  // da questo gruppo di rotte) — nessun altro contenuto è accessibile.
  if (soloConfermaUscita) {
    redirect("/uscita");
  }

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
          {/*
            Il footer è SEMPRE fisso a fondo schermo (mobile e desktop): il
            contenuto ha bisogno di spazio in fondo per non finirci coperto.
            Su mobile la misura include anche la safe-area del dispositivo
            (barra home su iPhone con notch/isola); su desktop basta uno spazio
            leggermente più piccolo perché il footer è su una riga sola.
          */}
          <div className="mx-auto max-w-6xl px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-16 md:pt-8">
            {children}
          </div>
        </main>

        {/*
          Footer sempre fisso a fondo schermo, su TUTTE le dimensioni: resta
          visibile ai piedi della pagina anche quando si arriva in fondo allo
          scroll, non compare solo a fine pagina. Il padding inferiore include
          la safe-area: su iPhone con barra home il testo non deve mai finirci
          addosso o sotto.
        */}
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:pt-4 sm:pb-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              ToothTalk<sup className="ml-0.5 align-super text-[8px]">™</sup> —
              progetto di divulgazione odontoiatrica
            </span>
            <div className="flex items-center gap-3">
              <Link href="/documenti" className="hover:text-slate-600">
                Documenti
              </Link>
              <Link href="/privacy" className="hover:text-slate-600">
                Privacy e cookie
              </Link>
            </div>
          </div>
        </footer>

        <BannerConsenso />
      </div>
    </PoloAttivoProvider>
  );
}
