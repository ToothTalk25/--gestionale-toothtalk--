import { requireSession } from "@/lib/auth";

type Risorsa = {
  titolo: string;
  descrizione: string;
  facoltativo?: boolean;
  href?: string;
};

/**
 * Materiali di riferimento per i collaboratori (piano/calendario editoriale,
 * guide pratiche) — a differenza di /documenti (i modelli legali, pubblici),
 * questa sezione è per contenuti operativi/editoriali, riservata a chi è
 * loggato. I contenuti vengono aggiunti qui via codice quando pronti: non è
 * un'area che il Coordinatore aggiorna da solo dal gestionale.
 */
const risorse: Risorsa[] = [
  {
    titolo: "Piano editoriale",
    descrizione: "La linea editoriale del progetto: temi, obiettivi e criteri per i contenuti.",
  },
  {
    titolo: "Calendario editoriale",
    descrizione: "Le uscite programmate e le scadenze del canale.",
  },
  {
    titolo: "Guida pratica alla realizzazione di un format",
    descrizione: "Consigli operativi per chi vuole approfondire come si costruisce un format da zero.",
    facoltativo: true,
  },
];

export default async function RisorsePage() {
  await requireSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Risorse</h1>
        <p className="mt-1 text-sm text-slate-500">
          Materiali di riferimento per lavorare ai progetti: piano e calendario
          editoriale, guide pratiche.
        </p>
      </div>

      <section className="space-y-3">
        {risorse.map((r) =>
          r.href ? (
            <a key={r.titolo} href={r.href} className="block tt-card p-5 transition hover:ring-tt-blue/40">
              <ContenutoRisorsa risorsa={r} />
            </a>
          ) : (
            <div key={r.titolo} className="tt-card p-5">
              <ContenutoRisorsa risorsa={r} />
              <p className="mt-2 text-xs text-slate-400">Contenuto in arrivo</p>
            </div>
          ),
        )}
      </section>
    </div>
  );
}

function ContenutoRisorsa({ risorsa }: { risorsa: Risorsa }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-base font-medium text-slate-900">{risorsa.titolo}</p>
        {risorsa.facoltativo && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            Facoltativo
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">{risorsa.descrizione}</p>
    </>
  );
}
