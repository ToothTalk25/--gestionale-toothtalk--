import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { ISTRUZIONI_INSTALLAZIONE } from "@/lib/onboarding-testo";

/**
 * Pagina pubblica raggiunta dal link mandato dall'admin (sezione "Invia
 * link di accesso"): valida solo per 7 giorni (0119_inviti_onboarding.sql).
 * Non è un'azione singola da consumare — resta consultabile più volte
 * finché il token non scade, per chi vuole reinstallare su un altro
 * dispositivo nel frattempo.
 */
export default async function BenvenutoPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const valido = token ? await verificaToken(token) : false;

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <img src="/logo-toothtalk.svg" alt="ToothTalk" className="mx-auto h-8 w-auto" />

      {!valido ? (
        <div className="mt-6 tt-card border border-red-200 p-6 text-center">
          <h2 className="text-lg font-semibold text-red-800">Link non più valido</h2>
          <p className="mt-1 text-sm text-red-600">
            Questo link è scaduto (i link di accesso durano 7 giorni). Chiedi al
            chi ti ha mandato il link di inviartene uno nuovo.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="tt-card p-6 text-center">
            <h1 className="text-xl font-semibold tracking-[-0.015em]">Benvenuto in ToothTalk</h1>
            <p className="mt-2 text-sm text-slate-600">
              Ecco il tuo accesso al Gestionale — ti conviene installarlo come app: si
              apre più veloce, a schermo intero, senza la barra del browser.
            </p>
            <Link
              href="/login"
              className="tt-btn mt-4 inline-block bg-tt-blue px-6 py-2.5 text-sm text-white"
            >
              Vai al Gestionale
            </Link>
          </div>

          <div className="tt-card p-6">
            <h2 className="text-[15px] font-semibold">Come installarlo</h2>
            <div className="mt-3 space-y-4">
              {ISTRUZIONI_INSTALLAZIONE.map((p) => (
                <div key={p.titolo}>
                  <p className="text-sm font-medium text-slate-700">{p.titolo}</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-600">
                    {p.passi.map((passo, i) => (
                      <li key={i}>{passo}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function verificaToken(token: string): Promise<boolean> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("verifica_token_onboarding", { p_token: token });
  return data === true;
}
