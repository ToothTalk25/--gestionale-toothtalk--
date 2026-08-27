"use client";

import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import CaricaRinnovo from "@/components/CaricaRinnovo";
import type { Profile } from "@/lib/types";

/**
 * Pagina di rinnovo dell'Accordo Editoriale scaduto (Art. 9.1): chi è qui ha
 * l'accesso ai progetti sospeso e carica il documento di rinnovo firmato per
 * riattivarlo. La card di upload è quella condivisa (CaricaRinnovo), usata
 * anche in /profilo per il caricamento anticipato.
 */
export default function RinnovoAccordo({ profile }: { profile: Profile }) {
  const router = useRouter();

  const scadutoIl = profile.accordo_scadenza
    ? new Date(`${profile.accordo_scadenza}T00:00:00`).toLocaleDateString("it-IT")
    : "—";

  async function esci() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
  }

  return (
    <section className="tt-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-[-0.015em]">
          Accordo Editoriale scaduto
        </h1>
        <button
          onClick={esci}
          className="tt-btn border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
        >
          Esci
        </button>
      </div>

      <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Il tuo Accordo Editoriale è scaduto il <strong>{scadutoIl}</strong>:
        carica il documento di rinnovo per riattivare l&apos;accesso. Finché
        il Coordinatore non lo approva, l&apos;accesso ai progetti resta
        sospeso (Art. 9.1 dell&apos;Accordo).
      </p>

      <p className="mt-4 text-sm text-slate-600">
        Enrico ti invierà il documento di rinnovo (breve, meno di una pagina):
        firmalo, scansiona o fotografa il firmato e caricalo qui, come hai
        fatto con l&apos;accordo iniziale.
      </p>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <CaricaRinnovo profile={profile} />
      </div>
    </section>
  );
}
