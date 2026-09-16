import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import MenuUtente from "@/components/MenuUtente";
import PannelloDomandeTecniche, { type RigaDomandaTecnica } from "@/components/PannelloDomandeTecniche";

/**
 * Pagina del Collaboratore Tecnico (ruolo 'tecnico', migrazioni 0133-0134):
 * l'unico posto che gli è riservato nel gestionale.
 *
 * Sta FUORI dal gruppo (app) di proposito. Il Collaboratore Tecnico non ha
 * accordo editoriale né appartenenza a un gruppo — per la RLS non vede polos,
 * progetti, magazzino, chat — quindi le regole del layout (app) non lo
 * riguardano: qui non esiste nessun loop di redirect.
 *
 * La RLS è l'unica che filtra davvero i dati: la select qui sotto, eseguita
 * con la sua sessione, può restituire SOLO le righe categoria_ia = 'tecnica'
 * (policy domande_supporto_tecnico_select, 0134).
 *
 * L'accesso globale può aprire questa pagina per controllo (vede tutto), ma
 * il suo posto resta /admin.
 */
export default async function TecnicoPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.profile.role !== "tecnico" && !ctx.isAdmin) redirect("/dashboard");

  const supabase = await supabaseServer();
  const { data: domande } = await supabase
    .from("domande_supporto")
    .select("id, user_id, domanda, creato_at, risposta, risposto_at")
    .eq("categoria_ia", "tecnica")
    .order("creato_at", { ascending: false })
    .returns<RigaDomandaTecnica[]>();

  const elenco = domande ?? [];

  // Nome di battesimo di chi ha chiesto, e solo quello: la funzione
  // nome_battesimo (0134) è l'unico modo per leggerlo e non restituisce
  // nient'altro (Documento 5, Art. 8.2, minimizzazione).
  const nomi: Record<string, string> = {};
  for (const id of [...new Set(elenco.map((d) => d.user_id))]) {
    const { data } = await supabase.rpc("nome_battesimo", { p_user: id });
    nomi[id] = typeof data === "string" && data ? data : "—";
  }

  const inAttesa = elenco.filter((d) => !d.risposta).length;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 md:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <header className="tt-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">ToothTalk™</p>
              <h1 className="mt-1 text-xl font-semibold text-slate-800">Domande tecniche</h1>
            </div>
            <MenuUtente profile={ctx.profile} isAdmin={ctx.isAdmin} />
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Qui arrivano le domande tecniche dei Collaboratori. La risposta che scrivi va
            <strong> direttamente a chi l&apos;ha scritta</strong>: non passa da nessun altro.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {elenco.length === 0
              ? "Nessuna domanda finora."
              : inAttesa === 0
                ? `${elenco.length} domande, tutte risposte.`
                : `${inAttesa} in attesa di risposta su ${elenco.length}.`}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Di chi scrive vedi solo il nome: per rispondere a una domanda tecnica non serve
            sapere altro.
          </p>
        </header>

        <PannelloDomandeTecniche domande={elenco} nomi={nomi} />
      </div>
    </main>
  );
}
