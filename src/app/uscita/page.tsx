import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import DocumentiUscente from "@/components/DocumentiUscente";
import ConfermaUscitaArt94 from "@/components/ConfermaUscitaArt94";

/**
 * Pagina dedicata (fuori dal gruppo (app)) all'uscita dal progetto. Due
 * blocchi autonomi, in ordine:
 *  1. "I tuoi documenti": accordo firmato, modulo di nomina, portabilità —
 *     accessibili a prescindere dalla conferma (art. 15/20 GDPR).
 *  2. Conferma Art. 9.4: passaggio separato e indipendente dai documenti.
 * Raggiungibile solo da account disattivati con richiesta pendente
 * (soloConfermaUscita): chiunque altro viene rimandato via.
 */
export default async function UscitaPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.soloConfermaUscita) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-2xl space-y-5">
        <DocumentiUscente />
        <ConfermaUscitaArt94 />
      </div>
    </main>
  );
}
