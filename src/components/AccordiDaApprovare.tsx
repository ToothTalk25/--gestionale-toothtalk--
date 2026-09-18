"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import {
  caricaControfirmaAccordo,
  inviaAccordoFirmatoPerEmail,
  preparaUploadControfirma,
  rivalutaAccordoConIA,
  verificaManualeAccordo,
} from "@/app/actions-profilo";

export type RigaAccordoDaApprovare = {
  id: string;
  full_name: string | null;
  email: string;
  accordo_caricato_at: string | null;
  accordo_verificato: string | null;
  accordo_verifica_note: string | null;
};

/**
 * Stessa riga della coda, ma per chi non ha (ancora) un esito IA 'ok': i
 * campi letti dallo schermo sono identici, cambia solo cosa si può fare —
 * rifare la verifica, o farsi mandare il PDF per la controfirma a mano.
 */
export type RigaAccordoDaRivalutare = RigaAccordoDaApprovare;

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
 *
 * Sotto la coda c'è il blocco di chi ha caricato ma non ha un esito 'ok' (il
 * caso vero: verifica mai eseguita perché la chiave dell'IA non era
 * configurata sul server). Da lì si rifà la verifica — senza chiedere alla
 * persona di ricaricare un documento che è già a posto — e ci si fa mandare
 * per email la copia firmata che serve per la controfirma a mano.
 */
export default function AccordiDaApprovare({
  accordi,
  daRivalutare = [],
}: {
  accordi: RigaAccordoDaApprovare[];
  daRivalutare?: RigaAccordoDaRivalutare[];
}) {
  const router = useRouter();
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inVerificaManuale, setInVerificaManuale] = useState<string | null>(null);
  const [motivoVerifica, setMotivoVerifica] = useState("");

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

  /** Rifa la verifica IA sul documento già caricato: nessun nuovo upload. */
  async function rivaluta(userId: string) {
    setInCorso(`ia:${userId}`);
    setMessaggio(null);
    const esito = await rivalutaAccordoConIA(userId);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      `Verifica rifatta, esito: ${esito.dati.esito}` +
        (esito.dati.note ? ` — ${esito.dati.note}` : "") +
        (esito.dati.esito === "ok"
          ? ". L'accordo è ora in coda: carica la copia controfirmata a mano."
          : ". Un accordo entra in coda solo con esito ok: controlla il documento o il modello caricato."),
    );
    router.refresh();
  }

  /** Manda al Titolare che chiede la copia firmata, per la controfirma a mano. */
  async function inviaCopia(userId: string) {
    setInCorso(`email:${userId}`);
    setMessaggio(null);
    const esito = await inviaAccordoFirmatoPerEmail(userId);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      `Accordo firmato inviato a ${esito.dati.destinatario}: in allegato c'è il PDF da stampare, firmare e scansionare.`,
    );
    router.refresh();
  }

  /**
   * Il controllo a mano dell'accesso globale, quando il controllo automatico
   * non è disponibile: il motivo è obbligatorio e resta nel registro.
   */
  async function confermaVerificaManuale(userId: string) {
    setInCorso(`mano:${userId}`);
    setMessaggio(null);
    const esito = await verificaManualeAccordo(userId, motivoVerifica);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setInVerificaManuale(null);
    setMotivoVerifica("");
    setMessaggio(
      "Verifica a mano registrata: l'accordo è ora in coda. Il motivo resta scritto nel Registro insieme al tuo nome.",
    );
    router.refresh();
  }

  if (accordi.length === 0 && daRivalutare.length === 0) {
    return (
      <section className="tt-card p-4 md:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Accordi da approvare</h2>
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nessun accordo in attesa di approvazione e nessuna verifica da rifare. ✅
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

      {accordi.length === 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Nessun accordo con verifica superata in attesa di controfirma.
        </p>
      )}

      {daRivalutare.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <p className="text-[13px] font-semibold text-amber-900">
            Verifica IA non riuscita ({daRivalutare.length})
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Hanno caricato l&apos;accordo firmato, ma l&apos;esito del controllo automatico non
            è &quot;ok&quot;: per questo non entrano nella coda qui sotto. Non serve
            chiedere di ricaricare — il documento è già nel gestionale e integro, qui
            si rifà il controllo. &quot;Mandami il PDF&quot; spedisce a te la copia firmata,
            che serve per la controfirma a mano.
          </p>
          <div className="mt-3 space-y-2">
            {daRivalutare.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
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
                    <p className="mt-1 text-xs text-amber-800">
                      <strong>IA: {a.accordo_verificato ?? "mai eseguita"}</strong>
                      {a.accordo_verifica_note ? ` — ${a.accordo_verifica_note}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => inviaCopia(a.id)}
                      disabled={inCorso === `email:${a.id}`}
                      className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {inCorso === `email:${a.id}` ? "Invio…" : "Mandami il PDF"}
                    </button>
                    <button
                      onClick={() => rivaluta(a.id)}
                      disabled={inCorso === `ia:${a.id}`}
                      className="tt-btn bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {inCorso === `ia:${a.id}` ? "Controllo…" : "Rivaluta con l'IA"}
                    </button>
                    <button
                      onClick={() => {
                        setInVerificaManuale(a.id);
                        setMotivoVerifica("");
                      }}
                      disabled={inCorso === `mano:${a.id}`}
                      className="tt-btn border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Verifica tu, a mano
                    </button>
                  </div>
                </div>

                {inVerificaManuale === a.id && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3">
                    <label className="text-xs font-medium text-amber-900">
                      Che cosa hai controllato nel PDF di {a.full_name ?? a.email}? Resta nel
                      Registro come tua firma sul controllo — non è un automatismo.
                    </label>
                    <textarea
                      value={motivoVerifica}
                      onChange={(e) => setMotivoVerifica(e.target.value)}
                      rows={2}
                      className="mt-1.5 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                      placeholder="es. confrontato clausola per clausola col modello, firma manoscritta presente in fondo a pagina 4…"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => setInVerificaManuale(null)}
                        className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Annulla
                      </button>
                      <button
                        onClick={() => confermaVerificaManuale(a.id)}
                        disabled={inCorso === `mano:${a.id}`}
                        className="tt-btn bg-amber-700 px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
                      >
                        {inCorso === `mano:${a.id}` ? "Registro…" : "Registra la mia verifica"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                  onClick={() => inviaCopia(a.id)}
                  disabled={inCorso === `email:${a.id}`}
                  className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {inCorso === `email:${a.id}` ? "Invio…" : "Mandami il PDF"}
                </button>
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
