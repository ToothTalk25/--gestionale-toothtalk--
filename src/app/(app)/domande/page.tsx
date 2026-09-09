import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import FormDomanda from "@/components/FormDomanda";
import type { RigaDomandaSupporto } from "@/app/actions-supporto";

export default async function DomandePage() {
  await requireSession();
  const supabase = await supabaseServer();

  // RLS filtra già alle sole domande dell'utente loggato.
  const { data: domande } = await supabase
    .from("domande_supporto")
    .select("id, user_id, domanda, creato_at, categoria_ia, bozza_risposta_ia, risposta, risposto_da, risposto_at")
    .order("creato_at", { ascending: false })
    .returns<RigaDomandaSupporto[]>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Domande</h1>
        <p className="mt-1 text-sm text-slate-500">
          Chiedi al Coordinatore qualsiasi cosa sul processo editoriale o su un
          problema tecnico del gestionale.
        </p>
      </div>

      <FormDomanda />

      {(domande ?? []).length > 0 && (
        <section className="space-y-3">
          {(domande ?? []).map((d) => (
            <div key={d.id} className="tt-card p-4">
              <p className="text-sm text-slate-800">{d.domanda}</p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(d.creato_at).toLocaleString("it-IT")}
              </p>
              {d.risposta ? (
                <div className="mt-3 rounded-lg bg-tt-blue-50 p-3">
                  <p className="text-xs font-medium text-tt-blue-600">Risposta del Coordinatore</p>
                  <p className="mt-1 text-sm text-slate-700">{d.risposta}</p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-amber-700">In attesa di risposta…</p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
