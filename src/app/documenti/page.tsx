import Link from "next/link";

const documenti = [
  {
    href: "/documenti/1-accordo-editoriale.docx",
    numero: "Documento 1",
    titolo: "Accordo Editoriale",
    descrizione:
      "Modello dell'accordo di collaborazione volontaria che ogni Collaboratore firma al momento della registrazione.",
  },
  {
    href: "/documenti/2-informativa-liberatoria-esterni.docx",
    numero: "Documento 2",
    titolo: "Informativa e Liberatoria per interviste",
    descrizione:
      "Informativa privacy e liberatoria compilabile online dai soggetti esterni intervistati (non Collaboratori).",
  },
  {
    href: "/documenti/3-protocollo-operativo.docx",
    numero: "Documento 3",
    titolo: "Protocollo Operativo e Comportamentale",
    descrizione:
      "Regole operative e comportamentali per la realizzazione dei contenuti, allegato all'Accordo Editoriale.",
  },
  {
    href: "/documenti/4-modulo-nomina.docx",
    numero: "Documento 4",
    titolo: "Modulo di nomina individuale",
    descrizione:
      "Nomina a persona autorizzata al trattamento dei dati, generata automaticamente all'approvazione dell'Accordo.",
  },
];

/**
 * Libreria documenti: i quattro modelli ufficiali del Progetto, sempre
 * consultabili. Sono i MODELLI (con campi da compilare), non le copie
 * firmate dai singoli Collaboratori — quelle restano private nel profilo
 * di ciascuno.
 */
export default function DocumentiPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
      <h1 className="mt-6 text-2xl font-semibold">Libreria documenti</h1>
      <p className="mt-1 text-sm text-slate-500">
        I modelli ufficiali del Progetto. Questi sono i testi di riferimento, non
        le copie firmate: la tua copia firmata resta nel tuo{" "}
        <Link href="/profilo" className="text-tt-blue underline">
          profilo
        </Link>
        .
      </p>

      <section className="mt-8 space-y-3">
        {documenti.map((d) => (
          <a
            key={d.href}
            href={d.href}
            download
            className="block tt-card p-5 transition hover:ring-tt-blue/40"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-tt-blue">{d.numero}</p>
            <p className="mt-1 text-base font-medium text-slate-900">{d.titolo}</p>
            <p className="mt-1 text-sm text-slate-500">{d.descrizione}</p>
            <p className="mt-2 text-xs text-slate-400">Scarica (.docx) →</p>
          </a>
        ))}
      </section>

      <p className="mt-8 text-xs text-slate-400">
        Vedi anche:{" "}
        <Link href="/privacy" className="text-tt-blue underline">
          informativa privacy
        </Link>{" "}
        e{" "}
        <Link href="/termini" className="text-tt-blue underline">
          termini di servizio
        </Link>
        .
      </p>
    </main>
  );
}
