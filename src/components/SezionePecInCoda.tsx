/**
 * Un tipo per la riga di coda, condiviso fra la pagina del Registro e il
 * componente: le colonne restano snake_case, come in tutto il progetto.
 */
export type RigaPecInCoda = {
  id: string;
  creato_at: string;
  stato: string;
  oggetto: string;
  destinatari: string[];
  copia_conoscenza: string[] | null;
  tentativi: number;
  ultimo_errore: string | null;
  inviata_at: string | null;
};

/** Quante ore sono passate da una data ISO. */
function oreDa(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/**
 * Sezione admin "PEC da spedire" — la coda della migrazione 0139.
 *
 * Da quando Aruba blocca gli invii automatici che escono da indirizzi esteri
 * (e Vercel non ha regioni italiane), il gestionale non spedisce più le PEC:
 * le prepara e le mette in coda qui. A spedirle è un comando eseguito sul
 * computer del progetto, che esce da un indirizzo italiano — quello che Aruba
 * non blocca (ticket 19039798A).
 *
 * Finché una riga è in coda, quel documento NON ha ancora data certa: è la
 * cosa più importante da capire leggendo questa sezione.
 */
export default function SezionePecInCoda({ righe }: { righe: RigaPecInCoda[] }) {
  const daSpedire = righe.filter((r) => r.stato === "in_coda");
  const inErrore = righe.filter((r) => r.stato === "errore");
  const spedite = righe.filter((r) => r.stato === "inviata").slice(0, 5);
  // L'elenco arriva dal più recente: l'ultimo in coda è la PEC che aspetta da più tempo.
  const piuVecchia = daSpedire.length ? daSpedire[daSpedire.length - 1] : null;
  const attesa = piuVecchia ? oreDa(piuVecchia.creato_at) : 0;

  return (
    <section className="tt-card p-4 md:p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">PEC da spedire</h2>
      <p className="mt-1 text-xs text-slate-400">
        Le PEC non partono più dalla piattaforma: Aruba blocca gli invii che escono da
        indirizzi esteri, e la piattaforma non ne ha di italiani. Il gestionale le prepara e
        le mette in coda; a spedirle è un comando eseguito sul computer del progetto.
        <strong> Finché una PEC è in coda, quel documento non ha ancora data certa.</strong>
      </p>

      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-600">Nel Terminale, dalla cartella del progetto:</p>
        <p className="mt-1 font-mono text-[12px] text-slate-800">npm run pec</p>
        <p className="text-[11px] text-slate-500">
          mostra cosa spedirebbe e verifica che i file corrispondano (nessun invio)
        </p>
        <p className="mt-1 font-mono text-[12px] text-slate-800">npm run pec -- --esegui</p>
        <p className="text-[11px] text-slate-500">
          spedisce davvero, dall&apos;indirizzo di casa/ufficio
        </p>
      </div>


      {daSpedire.length > 0 && (
        <div
          className={`mt-4 rounded-lg border p-3 ${
            attesa > 24 ? "border-amber-200 bg-amber-50/50" : "border-slate-200"
          }`}
        >
          <p className="text-[13px] font-semibold text-slate-800">
            {daSpedire.length === 1 ? "1 PEC in attesa" : `${daSpedire.length} PEC in attesa`}
            {attesa > 24 && ` — la più vecchia da ${Math.floor(attesa / 24)} giorni`}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {daSpedire.map((r) => (
              <li key={r.id}>
                • {r.oggetto} → {r.destinatari.join(", ")}
                <span className="text-slate-400">
                  {" "}
                  · preparata {new Date(r.creato_at).toLocaleString("it-IT")}
                </span>
              </li>
            ))}
          </ul>
          {attesa > 24 && (
            <p className="mt-2 text-xs text-amber-800">
              Da più di un giorno: quei documenti aspettano la loro data certa. Il promemoria
              arriva anche con il controllo notturno dell&apos;integrità.
            </p>
          )}
        </div>
      )}

      {inErrore.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <p className="text-[13px] font-semibold text-red-800">
            {inErrore.length === 1 ? "1 PEC ferma in errore" : `${inErrore.length} PEC ferme in errore`}
          </p>
          <p className="mt-1 text-xs text-red-700">
            Non ripartono da sole: un errore va letto prima (di solito il file non corrisponde
            più all&apos;impronta registrata quando la PEC è stata messa in coda). Si riprovano
            una per una con <span className="font-mono">npm run pec -- --esegui --id &lt;id&gt;</span>.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-red-800">
            {inErrore.map((r) => (
              <li key={r.id}>
                • {r.oggetto}
                <span className="block pl-3 text-red-700">
                  {r.ultimo_errore ?? "motivo non registrato"}
                </span>
                <span className="block pl-3 font-mono text-[11px] text-red-400">
                  {r.id} · tentativi: {r.tentativi}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {spedite.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">Spedite di recente</p>
          <div className="mt-2 space-y-1">
            {spedite.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-1.5 text-xs text-slate-500"
              >
                <span>{r.oggetto}</span>
                <span className="text-emerald-700">
                  {r.inviata_at ? new Date(r.inviata_at).toLocaleString("it-IT") : ""}
                </span>
              </div>
            ))}
          </div>
          {spedite.some((r) => r.ultimo_errore) && (
            <p className="mt-2 text-xs text-amber-800">
              Una PEC spedita può portare una nota: è partita, ma lo stato collegato non si è
              aggiornato da solo e va sistemato a mano.
            </p>
          )}
        </div>
      )}

      {!daSpedire.length && !inErrore.length && !spedite.length && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Niente in coda. Quando il gestionale prepara una PEC (un accordo, un rinnovo, un
          verbale) la trovi qui, con quello che manca per spedirla.
        </p>
      )}
    </section>
  );
}
