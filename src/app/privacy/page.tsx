import Link from "next/link";
import { INFORMATIVA_PRIVACY, type Blocco } from "@/lib/informativa-privacy";

function RigaBlocco({ b }: { b: Blocco }) {
  if (b.tipo === "h2") return <h2 className="text-base font-medium text-slate-900">{b.testo}</h2>;
  if (b.tipo === "p") return <p className="mt-1">{b.testo}</p>;
  return (
    <ul className="mt-1 list-disc space-y-1 pl-5">
      {b.voci.map((v, i) => (
        <li key={i}>{v}</li>
      ))}
    </ul>
  );
}

// Un h2 apre un nuovo blocco (div con spazio sopra); p/ul che seguono
// restano nello stesso blocco finché non arriva il prossimo h2.
function raggruppaPerSezione(blocchi: Blocco[]): Blocco[][] {
  const gruppi: Blocco[][] = [];
  for (const b of blocchi) {
    if (b.tipo === "h2" || gruppi.length === 0) gruppi.push([b]);
    else gruppi[gruppi.length - 1].push(b);
  }
  return gruppi;
}

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; token?: string }>;
}) {
  const { from, token } = await searchParams;
  const dallGestionale = from === "app";
  const dallaLiberatoria = from === "liberatoria" && !!token;
  const sezioni = raggruppaPerSezione(INFORMATIVA_PRIVACY);

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-9 w-auto" />
        <h1 className="mt-6 text-2xl font-semibold text-tt-ink">Informativa privacy</h1>
        <p className="mt-1 text-sm text-slate-500">
          Ai sensi del Regolamento (UE) 2016/679 (GDPR) — aggiornata al 21 agosto 2026
        </p>

      <section className="mt-6 tt-card space-y-6 p-6 text-sm leading-relaxed text-slate-700 sm:p-8">
        {sezioni.map((gruppo, i) => (
          <div key={i}>
            {gruppo.map((b, j) => (
              <RigaBlocco key={j} b={b} />
            ))}
          </div>
        ))}

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
          Ultimo aggiornamento: 21 agosto 2026 ·{" "}
          {dallGestionale ? (
            <Link href="/dashboard" className="underline">
              Torna al gestionale
            </Link>
          ) : dallaLiberatoria ? (
            <Link href={`/carica-liberatoria?token=${encodeURIComponent(token!)}`} className="underline">
              Torna alla liberatoria
            </Link>
          ) : (
            <Link href="/login" className="underline">
              Torna al login
            </Link>
          )}
        </p>
      </section>
      </div>
    </main>
  );
}
