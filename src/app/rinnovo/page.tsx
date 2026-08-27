import { redirect } from "next/navigation";
import { getSessionContext, accordoScaduto } from "@/lib/auth";
import RinnovoAccordo from "@/components/RinnovoAccordo";

/**
 * Pagina dedicata (fuori dal gruppo (app)) al rinnovo dell'Accordo
 * Editoriale (Art. 9.1): l'accesso ai progetti è sospeso e qui si carica il
 * documento di rinnovo per riattivarlo. Raggiungibile SOLO da chi è davvero
 * in stato "scaduto": chiunque altro viene rimandato al dashboard (stesso
 * pattern di /uscita per la conferma Art. 9.4). Essendo fuori dal gruppo
 * (app), il layout dell'app non gira mai qui: nessun loop di redirect.
 */
export default async function RinnovoPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // L'admin non ha accordo e non è mai soggetto alla scadenza.
  if (ctx.isAdmin) redirect("/dashboard");
  if (!accordoScaduto(ctx.profile.accordo_scadenza)) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-2xl space-y-5">
        <RinnovoAccordo profile={ctx.profile} />
      </div>
    </main>
  );
}
