import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
      <h1 className="mt-6 text-2xl font-semibold">Informativa privacy</h1>
      <p className="mt-1 text-sm text-slate-500">
        Ai sensi del Regolamento (UE) 2016/679 (GDPR) — aggiornata al 10 agosto 2026
      </p>

      <section className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
        <div>
          <h2 className="text-base font-medium text-slate-900">Titolare del trattamento</h2>
          <p className="mt-1">
            ToothTalk, progetto di divulgazione odontoiatrica, rappresentato dal
            referente del progetto. Contatto: attraverso il gestionale o l&apos;account
            email del progetto.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">Quali dati trattiamo</h2>
          <ul className="mt-1 list-disc pl-5">
            <li>Dati anagrafici essenziali: nome, cognome, email, università</li>
            <li>Foto del profilo</li>
            <li>Accordo editoriale firmato (PDF)</li>
            <li>Video, script e materiali depositati nel gestionale</li>
            <li>Dati di accesso e log delle operazioni</li>
          </ul>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">Perché e con quale base giuridica</h2>
          <ul className="mt-1 list-disc pl-5">
            <li>
              <strong>Esecuzione del progetto</strong>: organizzare la partecipazione
              dei gruppi universitari e la realizzazione dei video
            </li>
            <li>
              <strong>Consenso (art. 6.1.a GDPR)</strong>: caricamento della foto,
              dell&apos;accordo e dei materiali
            </li>
            <li>
              <strong>Interesse legittimo (art. 6.1.f GDPR)</strong>: tutela legale del
              contenuto attraverso la certificazione via PEC e il registro append-only
            </li>
          </ul>
          <p className="mt-2">
            L&apos;accordo firmato viene inviato via PEC al referente del progetto: è la
            registrazione con data certa che protegge chi realizza i video.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">Conservazione</h2>
          <p className="mt-1">
            I file (video, foto, materiali) restano sulla piattaforma solo il tempo
            necessario a scaricarli e pubblicarli, e possono essere eliminati dopo
            l&apos;invio della PEC. I metadati, le impronte e i verbali PEC restano come
            registro append-only per esigenze di tutela legale, insieme alla copia
            già presente nella casella PEC e nelle caselle dei partecipanti.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">Chi vede i tuoi dati</h2>
          <p className="mt-1">
            L&apos;anagrafica completa è visibile solo a te e al referente del progetto.
            Gli altri partecipanti del gruppo vedono solo il tuo nome. I materiali
            depositati sono visibili ai partecipanti del tuo gruppo e al referente.
          </p>
        </div>

        <div>
          <h2 className="text-base font-medium text-slate-900">I tuoi diritti</h2>
          <p className="mt-1">
            Puoi esercitare in ogni momento i diritti previsti dal GDPR: accesso,
            rettifica, cancellazione, opposizione, limitazione, portabilità dei dati,
            e revoca del consenso. Per esercitarli contatta il referente del progetto.
            Hai inoltre il diritto di proporre reclamo al Garante per la protezione
            dei dati personali.
          </p>
        </div>

        <div id="cookie">
          <h2 className="text-base font-medium text-slate-900">Cookie policy</h2>
          <p className="mt-1">
            Il gestionale utilizza esclusivamente <strong>cookie tecnici</strong>:
            il cookie di sessione necessario all&apos;autenticazione (impostato da
            Supabase Auth). Nessun cookie di profilazione, nessun tracciamento di
            terze parti, nessuna pubblicità. Per questo motivo non serve il consenso
            per i cookie ai sensi dell&apos;art. 122 del Codice Privacy, ma la presente
            policy lo dichiara per trasparenza.
          </p>
        </div>

        <p className="pt-4 text-xs text-slate-400">
          Ultimo aggiornamento: 10 agosto 2026 ·{" "}
          <Link href="/login" className="underline">
            Torna al login
          </Link>
        </p>
      </section>
    </main>
  );
}
