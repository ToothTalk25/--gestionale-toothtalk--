import Link from "next/link";

export default function TerminiPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
        <h1 className="mt-6 text-2xl font-semibold text-tt-ink">Termini di servizio</h1>
        <p className="mt-1 text-sm text-slate-500">
          Condizioni d&apos;uso della piattaforma ToothTalk — aggiornate al 12 agosto 2026
        </p>

      <section className="mt-6 tt-card space-y-6 p-6 text-sm leading-relaxed text-slate-700 sm:p-8">
        <div>
          <h2 className="text-base font-medium text-slate-900">1. Oggetto</h2>
          <p className="mt-1">
            ToothTalk è una piattaforma interna di divulgazione scientifica e
            odontoiatrica. Queste condizioni disciplinano l&apos;uso del gestionale
            e della piattaforma web da parte dei partecipanti ai gruppi
            territoriali (i &quot;poli&quot;) e di chi collabora al progetto.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">2. Ammissione e accesso</h2>
          <p className="mt-1">
            L&apos;accesso al gestionale è riservato ai partecipanti autorizzati.
            Ogni account è personale e non cedibile. I dati di accesso vanno
            custoditi con cura: qualsiasi attività svolta con il proprio account
            è considerata imputabile al titolare dell&apos;account.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">3. Contenuti e proprietà intellettuale</h2>
          <p className="mt-1">
            I materiali depositati (video, immagini, testi, script) restano di
            proprietà dei rispettivi autori, salvo quanto previsto
            dall&apos;accordo editoriale firmato, che ne regola l&apos;utilizzo per le
            finalità del progetto. ToothTalk si impegna a non diffondere
            materiale non ancora pubblicato. Ogni collaboratore garantisce di
            avere i diritti sui contenuti che deposita.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">4. Consegne e revisioni</h2>
          <p className="mt-1">
            Le consegne originali sono archiviate in modo immutabile (append-only)
            a tutela di chi le ha prodotte. Le modifiche dell&apos;amministrazione
            vengono salvate separatamente e restano distinguibili dall&apos;originale.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">5. Liberatorie e consensi</h2>
          <p className="mt-1">
            Qualora un video coinvolga persone esterne al progetto, la relativa
            liberatoria firmata è condizione necessaria per la pubblicazione. I
            consensi raccolti sono registrati e conservati secondo quanto previsto
            dalla{" "}
            <Link href="/privacy" className="text-tt-blue underline">
              privacy policy
            </Link>
            .
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">6. Uso corretto</h2>
          <p className="mt-1">
            È vietato caricare contenuti illeciti, diffamatori, discriminatori o
            che violino diritti di terzi, linee guida sulla comunicazione
            sanitaria o norme di legge. I contenuti a finalità divulgativa non
            sostituiscono la consulenza medica.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">7. Recesso ed eliminazione dell&apos;account</h2>
          <p className="mt-1">
            Il partecipante può richiedere la cancellazione del proprio account e
            dei propri dati personali (diritto all&apos;oblio). Restano conservati,
            per il periodo di prescrizione legale, i materiali e i documenti che
            costituiscono prova del rapporto, ai sensi dell&apos;art. 17(3)(e) GDPR.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">8. Limitazioni di responsabilità</h2>
          <p className="mt-1">
            La piattaforma è fornita per finalità interne di organizzazione e
            divulgazione del progetto ToothTalk. Il Coordinatore del progetto non è
            responsabile dell&apos;uso improprio dei contenuti da parte dei
            partecipanti, fatto salvo quanto previsto dalla legge.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">9. Modifiche</h2>
          <p className="mt-1">
            Le presenti condizioni possono essere aggiornate; la versione
            vigente è sempre disponibile a questa pagina.
          </p>
        </div>

        <p className="pt-4 text-xs text-slate-400">
          Contatto: enricoguarino25@gmail.com (PEC: enricomariaguarino@postecertifica.it). ·{" "}
          <Link href="/privacy" className="text-tt-blue underline">
            Privacy Policy
          </Link>{" "}
          ·{" "}
          <Link href="/privacy#cookie" className="text-tt-blue underline">
            Cookie Policy
          </Link>
        </p>
      </section>
      </div>
    </main>
  );
}
