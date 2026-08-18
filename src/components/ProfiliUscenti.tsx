import EliminaAccountAdmin from "@/components/EliminaAccountAdmin";

type ProfiloUscente = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  universita: string | null;
  accordo_path: string | null;
  accordo_caricato_at: string | null;
  accordo_verificato: string | null;
  attivo: boolean;
};

/**
 * Sezione "Profili uscenti" del Registro: ricorda all'Admin quali account
 * sono stati disattivati e cosa comporta la loro gestione. È SOLO un
 * promemoria informativo — nessuna azione automatica: ogni decisione
 * resta manuale e valutata caso per caso.
 */
export default function ProfiliUscenti({
  profili,
  poliDi,
  materialiDi,
}: {
  profili: ProfiloUscente[];
  poliDi: Record<string, string[]>;
  materialiDi: Record<string, number>;
}) {
  const uscenti = profili.filter((p) => !p.attivo && p.role !== "admin");

  if (uscenti.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white p-6 ring-1 ring-amber-200">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Profili uscenti</h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {uscenti.length} {uscenti.length === 1 ? "profilo" : "profili"}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Account disattivati o eliminati. Nessuna cancellazione automatica:
        la gestione è manuale e decidi tu caso per caso. Qui trovi il
        promemoria di cosa comporta eliminare un account.
      </p>

      <div className="mt-4 space-y-4">
        {uscenti.map((p) => {
          const materiali = materialiDi[p.id] ?? 0;
          return (
            <div key={p.id} className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.full_name ?? p.email}</p>
                  <p className="text-xs text-slate-500">{p.email}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Poli: {poliDi[p.id]?.join(", ") || "—"} · Università:{" "}
                    {p.universita || "—"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Materiali depositati:{" "}
                    <strong>{materiali}</strong> · Accordo editoriale:{" "}
                    {p.accordo_path ? (
                      <span className="text-emerald-700">
                        caricato
                        {p.accordo_caricato_at
                          ? ` il ${new Date(p.accordo_caricato_at).toLocaleDateString("it-IT")}`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-slate-400">non presente</span>
                    )}
                  </p>
                </div>
                <EliminaAccountAdmin userId={p.id} />
              </div>

              {/* Promemoria: cosa si perde, cosa si conserva, perché */}
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-lg bg-red-50 p-3 ring-1 ring-red-100">
                  <p className="font-medium text-red-700">Cosa si perde</p>
                  <ul className="mt-1 list-disc pl-4 text-red-800/80">
                    <li>Foto profilo e dati di contatto</li>
                    <li>Email, università, PEC</li>
                    <li>Consensi e appartenenze ai poli</li>
                    <li>Video grezzo (immagine/voce), se richiesto</li>
                  </ul>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-100">
                  <p className="font-medium text-emerald-700">Cosa si conserva</p>
                  <ul className="mt-1 list-disc pl-4 text-emerald-800/80">
                    <li>Accordo editoriale firmato (cessione di proprietà)</li>
                    <li>Script, copertina, descrizioni (certificati PEC)</li>
                    <li>Archivio certificato e copie PEC, immutabili</li>
                  </ul>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
                  <p className="font-medium text-slate-700">Perché conservare</p>
                  <p className="mt-1 text-slate-600">
                    Difesa legale in caso di contestazioni (Art. 17(3)(e) GDPR;
                    prescrizione ordinaria 10 anni). La conservazione delle
                    prove è un legittimo interesse del titolare.
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
