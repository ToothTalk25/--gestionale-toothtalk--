"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import { caricaControfirmaAccordo, preparaUploadControfirma } from "@/app/actions-profilo";

export type RigaAccordoDaApprovare = {
  id: string;
  full_name: string | null;
  email: string;
  accordo_caricato_at: string | null;
  accordo_verificato: string | null;
  accordo_verifica_note: string | null;
};

/**
 * Sezione admin "Accordi da approvare": coda dei collaboratori che hanno
 * caricato l'accordo, confermato la lettura e superato la verifica IA, e
 * attendono che il Titolare carichi la scansione della copia controfirmata
 * a mano (entrambe le firme) — quarta condizione per sbloccare l'accesso
 * ai progetti. Non basta ancora: manca la quinta, la conferma del
 * Collaboratore che è lo stesso documento che ha firmato (sezione dedicata
 * in ProfiloPersonale.tsx), che sola genera il Modulo di nomina.
 *
 * Attenzione: se l'esito IA è 'attenzione'/'errato' il profilo non appare
 * qui (la coda filtra solo esito='ok') — ma per sicurezza mostriamo la
 * nota e un avviso se per qualsiasi motivo l'esito non è ok.
 */
export default function AccordiDaApprovare({ accordi }: { accordi: RigaAccordoDaApprovare[] }) {
  const router = useRouter();
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  async function caricaControfirma(userId: string, file: File) {
    setInCorso(userId);
    setMessaggio(null);
    try {
      const sha = await sha256File(file);

      // Il cookie di sessione è HttpOnly: il browser non può più autenticarsi
      // da solo con Storage. L'URL firmato dal server vale una volta sola,
      // solo per questo path — non serve altro per caricare.
      const prep = await preparaUploadControfirma(userId, file.name);
      if (!prep.ok) throw new Error(prep.errore);

      const { error: eUpload } = await supabaseBrowser()
        .storage.from(prep.dati.bucket)
        .uploadToSignedUrl(prep.dati.path, prep.dati.token, file, {
          contentType: file.type || "application/pdf",
        });
      if (eUpload) throw new Error(eUpload.message);

      const esito = await caricaControfirmaAccordo(userId, prep.dati.path, sha);
      if (!esito.ok) throw new Error(esito.errore);

      setMessaggio(
        "Controfirma caricata e inviata via PEC al collaboratore: l'accesso ai progetti resta bloccato finché non conferma, dal proprio profilo, che è lo stesso documento che ha firmato.",
      );
      router.refresh();
    } catch (e) {
      setMessaggio(`Errore: ${e instanceof Error ? e.message : "upload fallito"}`);
    } finally {
      setInCorso(null);
      const input = inputRefs.current[userId];
      if (input) input.value = "";
    }
  }

  if (accordi.length === 0) {
    return (
      <section className="tt-card p-4 md:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Accordi da approvare</h2>
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nessun accordo in attesa di approvazione manuale. ✅
        </p>
      </section>
    );
  }

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Accordi da approvare</h2>
          <p className="mt-1 text-xs text-slate-400">
            Collaboratori che hanno caricato l&apos;accordo, confermato la lettura e
            superato la verifica IA: carica qui la scansione della copia cartacea
            controfirmata a mano (entrambe le firme). Manca comunque la conferma
            del collaboratore prima che l&apos;accesso si sblocchi davvero.
          </p>
        </div>
        <span className="rounded-full bg-[#fef3e2] px-[11px] py-[3px] text-xs font-semibold text-amber-700">
          {accordi.length} in attesa
        </span>
      </div>

      {messaggio && <p className="mt-3 text-sm text-slate-600">{messaggio}</p>}

      <div className="mt-3 space-y-2">
        {accordi.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{a.full_name ?? "—"}</p>
                <p className="text-xs text-slate-500">{a.email}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Caricato il{" "}
                  {a.accordo_caricato_at
                    ? new Date(a.accordo_caricato_at).toLocaleDateString("it-IT")
                    : "—"}
                </p>
                {a.accordo_verificato && (
                  <p
                    className={`mt-1 text-xs ${
                      a.accordo_verificato === "ok"
                        ? "text-emerald-700"
                        : "text-amber-800"
                    }`}
                  >
                    <strong>IA: {a.accordo_verificato}</strong>
                    {a.accordo_verifica_note ? ` — ${a.accordo_verifica_note}` : ""}
                  </p>
                )}
                {a.accordo_verificato !== "ok" && (
                  <p className="mt-1 text-xs text-red-600">
                    ⚠️ Esito IA non &quot;ok&quot;: controlla con particolare attenzione
                    prima di caricare la controfirma.
                  </p>
                )}
              </div>
              <div>
                <input
                  ref={(el) => {
                    inputRefs.current[a.id] = el;
                  }}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void caricaControfirma(a.id, file);
                  }}
                />
                <button
                  onClick={() => inputRefs.current[a.id]?.click()}
                  disabled={inCorso === a.id}
                  className="tt-btn bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {inCorso === a.id ? "Carico…" : "Carica controfirma"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
