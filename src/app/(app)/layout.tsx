import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireSession, accordoScaduto } from "@/lib/auth";
import MenuUtente from "@/components/MenuUtente";
import BannerConsenso from "@/components/BannerConsenso";
import NavLink from "@/components/NavLink";
import { PoloAttivoProvider } from "@/components/PoloAttivoContext";
import ControlloRicordami from "@/components/ControlloRicordami";

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

  // --- Quinto stato: accordo scaduto (Art. 9.1) ------------------------
  // Anche con le quattro condizioni dell'accordo iniziale soddisfatte,
  // l'accordo ha durata fissa di 6 mesi: alla scadenza l'accesso ai
  // progetti viene sospeso finché un documento di rinnovo non è approvato
  // dal Coordinatore (approvazione che sposta accordo_scadenza di 6 mesi).
  // L'admin non è mai soggetto a questo blocco. Chi è bloccato può restare
  // SOLO su /rinnovo, una pagina FUORI da questo gruppo di rotte — quindi
  // nessun loop di redirect (il layout non gira mai per /rinnovo).
  if (!isAdmin && accordoScaduto(profile.accordo_scadenza)) {
    redirect("/rinnovo");
  }

  return (
    <PoloAttivoProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
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
            Su mobile il footer è nel flusso (niente spazio riservato): da sm
            in su torna fisso, quindi serve di nuovo spazio in fondo perché il
            contenuto non ci finisca coperto sotto.
          */}
          <div className="mx-auto max-w-6xl px-4 pt-4 pb-8 sm:pb-16 md:px-12 md:pt-8">
            {children}
          </div>
        </main>

        {/*
          Su mobile il footer è normale, nel flusso della pagina: compare solo
          arrivando in fondo, non resta sovrapposto al contenuto (lì "rubava"
          spazio utile allo schermo). Da sm in su torna fisso come prima —
          niente scroll per vederlo, sullo schermo grande c'è spazio a
          sufficienza perché non dia fastidio.

          Il padding inferiore NON include qui la safe-area: essendo nel
          flusso della pagina (non più fixed), quello spazio lo riserva già
          il <body> globale (padding-bottom: env(safe-area-inset-bottom) in
          globals.css), applicato DOPO questo footer. Aggiungerlo anche qui
          significa riservarlo due volte: una striscia vuota fra il footer e
          il bordo vero dello schermo, che lo fa sembrare un rettangolo
          staccato invece di toccare il fondo. Da sm in su invece il footer
          torna fixed (ignora il padding del <body>), quindi lì l'unico posto
          dove riservare lo spazio resta lui stesso — ma sugli schermi grandi
          la safe-area del notch non è un problema pratico, quindi resta un
          padding fisso semplice come prima.
        */}
        <footer className="static border-t border-slate-100 bg-white pt-3 pb-3 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:fixed sm:inset-x-0 sm:bottom-0 sm:z-30 sm:pt-4 sm:pb-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between md:px-12">
            <span>
              ToothTalk<sup className="ml-0.5 align-super text-[8px]">™</sup> —
              progetto di divulgazione odontoiatrica
            </span>
            <div className="flex items-center gap-3">
              <Link href="/documenti" className="hover:text-slate-600">
                Documenti
              </Link>
              <Link href="/privacy?from=app" className="hover:text-slate-600">
                Privacy e cookie
              </Link>
            </div>
          </div>
        </footer>

        <BannerConsenso />
        <ControlloRicordami />
      </div>
    </PoloAttivoProvider>
  );
}
