"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { creaCodiceInvito, disattivaCodiceInvito } from "@/app/actions-invito";
import { inviaInvitoGruppo } from "@/app/actions-onboarding";
import type { Polo } from "@/lib/types";

export type RigaInvito = {
  id: string;
  codice: string;
  polo_id: string;
  gruppo: string;
  attivo: boolean;
  usi: number;
  max_usi: number | null;
  scade_il: string | null;
  utilizzabile: boolean;
};

/**
 * Inviti ai gruppi: un solo posto dove il codice del gruppo e l email di
 * invito partono insieme. Prima erano due sezioni staccate ("genera il
 * codice" e "invia il link") e chi riceveva solo il link si trovava davanti
 * al login senza poter entrare — il codice era l anello che mancava.
 */
export default function GestioneInviti({
  poli,
  inviti,
}: {
  poli: Polo[];
  inviti: RigaInvito[];
}) {
  const router = useRouter();
  const [poloId, setPoloId] = useState(poli[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [maxUsi, setMaxUsi] = useState("");
  const [scadenza, setScadenza] = useState("");
  const [esito, setEsito] = useState<string | null>(null);
  const [codiceNuovo, setCodiceNuovo] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const attivi = inviti.filter((i) => i.attivo);
  const codiceDelGruppo = attivi.find((i) => i.polo_id === poloId)?.codice ?? null;

  function invita(e: React.FormEvent) {
    e.preventDefault();
    setErrore(null);
    setEsito(null);
    setCodiceNuovo(null);
    start(async () => {
      const res = await inviaInvitoGruppo(email, poloId, {
        maxUsi: maxUsi ? Number(maxUsi) : null,
        scadeIl: scadenza ? new Date(scadenza + "T23:59:59").toISOString() : null,
      });
      if (!res.ok) {
        setErrore(res.errore);
        return;
      }
      setEsito(
        `Invito inviato a ${email} per il gruppo ${res.dati.gruppo}, con il codice ${res.dati.codice}.`,
      );
      setEmail("");
      router.refresh();
    });
  }

  /** Solo il codice, senza inviare niente: per condividerlo a mano. */
  function generaCodice() {
    setErrore(null);
    setEsito(null);
    setCodiceNuovo(null);
    start(async () => {
      const e = await creaCodiceInvito(
        poloId,
        maxUsi ? Number(maxUsi) : null,
        scadenza ? new Date(scadenza + "T23:59:59").toISOString() : null,
      );
      if (!e.ok) {
        setErrore(e.errore);
        return;
      }
      setCodiceNuovo(e.dati.codice);
      router.refresh();
    });
  }

  return (
    <section className="tt-card p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Inviti ai gruppi</h2>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Scegli il gruppo e l&apos;indirizzo: parte un&apos;unica email con il link di
        registrazione, il codice del gruppo e le istruzioni per installare il
        Gestionale come app. Se il gruppo non ha ancora un codice, nasce adesso.
      </p>

      <form onSubmit={invita} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          Gruppo
          <select
            value={poloId}
            onChange={(e) => setPoloId(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            {poli.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-500">
          Email della persona
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@esempio.it"
            className="mt-1 block w-64 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-xs text-slate-500">
          Max ingressi (facoltativo)
          <input
            type="number"
            min={1}
            value={maxUsi}
            onChange={(e) => setMaxUsi(e.target.value)}
            placeholder="illimitati"
            className="mt-1 block w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-xs text-slate-500">
          Scadenza (facoltativa)
          <input
            type="date"
            value={scadenza}
            onChange={(e) => setScadenza(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={pending || !poloId || !email}
          className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-40"
        >
          {pending ? "Invio…" : "Invia invito"}
        </button>
      </form>

      {codiceDelGruppo && (
        <p className="mt-3 text-xs text-slate-500">
          Codice del gruppo che verrà inviato:{" "}
          <strong className="font-mono">{codiceDelGruppo}</strong>
        </p>
      )}
      {esito && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{esito}</p>
      )}
      {codiceNuovo && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nuovo codice: <strong className="font-mono">{codiceNuovo}</strong> — se ce
          n&apos;era uno precedente, ora non funziona più.
        </p>
      )}
      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}

      {/* --------------------------------------------- codici attivi */}
      {attivi.length > 0 && (
        <div className="mt-5 overflow-x-auto md:overflow-visible">
          <table className="tabella-mobile w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-4">Gruppo</th>
                <th className="py-2 pr-4">Codice</th>
                <th className="py-2 pr-4">Usi</th>
                <th className="py-2 pr-4">Scadenza</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {attivi.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-2 pr-4" data-label="Gruppo">{i.gruppo}</td>
                  <td className="py-2 pr-4 font-mono font-medium" data-label="Codice">{i.codice}</td>
                  <td className="py-2 pr-4" data-label="Usi">
                    {i.usi}
                    {i.max_usi ? ` / ${i.max_usi}` : ""}
                  </td>
                  <td className="py-2 pr-4 text-xs" data-label="Scadenza">
                    {i.scade_il ? new Date(i.scade_il).toLocaleDateString("it-IT") : "—"}
                  </td>
                  <td className="py-2 text-right" data-label="Azioni">
                    <div className="flex flex-col items-start gap-1 md:flex-row md:items-center md:justify-end">
                      {!i.utilizzabile && (
                        <span className="text-xs text-amber-700 md:mr-3">non più utilizzabile</span>
                      )}
                      <button
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const e = await disattivaCodiceInvito(i.id);
                            if (!e.ok) setErrore(e.errore);
                            else router.refresh();
                          })
                        }
                        className="text-xs text-slate-400 hover:text-red-600 hover:underline"
                      >
                        Disattiva
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ----------------------- solo il codice, senza inviare niente */}
      <div className="mt-5 border-t border-slate-100 pt-3">
        <button
          disabled={pending || !poloId}
          onClick={generaCodice}
          className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
        >
          Genera solo un codice nuovo (senza inviare niente)
        </button>
      </div>
    </section>
  );
}
