"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import {
  type CollaboratoreTecnico,
  creaCollaboratoreTecnico,
  aggiungiAccessoTecnico,
  aggiornaAccessoTecnico,
  preparaUploadAccordoTecnico,
  caricaAccordoTecnico,
  preparaUploadRinnovoTecnico,
  caricaRinnovoTecnico,
  approvaRinnovoTecnico,
} from "@/app/actions-tecnico";

/** La scadenza è passata quando è OGGI + 1 giorno (stessa regola usata per l'accordo editoriale). */
function scaduta(scadenza: string): boolean {
  return new Date(`${scadenza}T23:59:59`) < new Date();
}

function dataIt(iso: string | null): string {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("it-IT") : "—";
}

export default function PannelloTecnico({ collaboratori }: { collaboratori: CollaboratoreTecnico[] }) {
  return (
    <div className="space-y-6">
      <NuovoCollaboratore />
      {collaboratori.length === 0 ? (
        <p className="tt-card p-6 text-sm text-slate-500">
          Ancora nessun Collaboratore Tecnico registrato.
        </p>
      ) : (
        <div className="space-y-4">
          {collaboratori.map((c) => (
            <CardCollaboratore key={c.id} collaboratore={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function NuovoCollaboratore() {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [nome, setNome] = useState("");
  const [contatto, setContatto] = useState("");
  const [documento5SottoscrittoIl, setDocumento5SottoscrittoIl] = useState("");
  const [accordoSha256, setAccordoSha256] = useState("");
  const [accordoScadenza, setAccordoScadenza] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!aperto) {
    return (
      <button
        onClick={() => setAperto(true)}
        className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white hover:brightness-95"
      >
        + Nuovo Collaboratore Tecnico
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErrore(null);
          const esito = await creaCollaboratoreTecnico({
            nome,
            contatto,
            documento5SottoscrittoIl: documento5SottoscrittoIl || null,
            accordoSha256: accordoSha256.trim() || null,
            accordoScadenza: accordoScadenza || null,
          });
          if (!esito.ok) {
            setErrore(esito.errore);
            return;
          }
          setAperto(false);
          setNome("");
          setContatto("");
          setDocumento5SottoscrittoIl("");
          setAccordoSha256("");
          setAccordoScadenza("");
          router.refresh();
        });
      }}
      className="space-y-3 tt-card-piccola p-5"
    >
      <div>
        <label className="block text-sm font-medium">Nome</label>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium">Contatto (email o PEC)</label>
        <input
          type="email"
          value={contatto}
          onChange={(e) => setContatto(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">Documento 5 sottoscritto il</label>
          <input
            type="date"
            value={documento5SottoscrittoIl}
            onChange={(e) => setDocumento5SottoscrittoIl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Scadenza accordo</label>
          <input
            type="date"
            value={accordoScadenza}
            onChange={(e) => setAccordoScadenza(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium">
          Impronta SHA-256 provvisoria (facoltativa)
        </label>
        <input
          value={accordoSha256}
          onChange={(e) => setAccordoSha256(e.target.value)}
          placeholder="solo se non hai ancora la scansione da caricare — es. da shasum -a 256"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
        />
        <p className="mt-1 text-xs text-slate-400">
          Non verificata dal server: appena carichi la scansione firmata (dopo
          aver salvato) questo valore viene sostituito da quello ricalcolato
          davvero sul file.
        </p>
      </div>
      {errore && <p className="text-xs text-red-600">{errore}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
        >
          {pending ? "Salvo…" : "Salva"}
        </button>
        <button
          type="button"
          onClick={() => setAperto(false)}
          className="tt-btn border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          Annulla
        </button>
      </div>
    </form>
  );
}

function CardCollaboratore({ collaboratore: c }: { collaboratore: CollaboratoreTecnico }) {
  const router = useRouter();

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{c.nome}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{c.contatto}</p>
        </div>
        {c.accordo_scadenza &&
          (scaduta(c.accordo_scadenza) ? (
            <span className="rounded-full bg-red-50 px-[11px] py-[3px] text-xs font-semibold text-red-700">
              Scaduto il {dataIt(c.accordo_scadenza)}
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-[11px] py-[3px] text-xs font-semibold text-emerald-700">
              Valido fino al {dataIt(c.accordo_scadenza)}
            </span>
          ))}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Documento 5 sottoscritto il {dataIt(c.documento5_sottoscritto_il)}
      </p>

      <ScansioneAccordo collaboratore={c} onCambiato={() => router.refresh()} />

      <RegistroAccessi collaboratoreId={c.id} accessi={c.collaboratori_tecnici_accessi} onCambiato={() => router.refresh()} />

      <SezioneRinnovo collaboratore={c} onCambiato={() => router.refresh()} />
    </section>
  );
}

/**
 * Impronta del Documento 5: se accordo_path è presente, il server l'ha
 * ricalcolata davvero sulla scansione caricata — è quella "verificata". Se
 * c'è solo un valore digitato a mano (nessun accordo_path), è provvisorio:
 * niente file dietro con cui confrontarlo in caso di contestazione.
 */
function ScansioneAccordo({
  collaboratore: c,
  onCambiato,
}: {
  collaboratore: CollaboratoreTecnico;
  onCambiato: () => void;
}) {
  const [copiato, setCopiato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function copiaHash() {
    if (!c.accordo_sha256) return;
    navigator.clipboard.writeText(c.accordo_sha256).then(() => {
      setCopiato(true);
      setTimeout(() => setCopiato(false), 1500);
    });
  }

  async function caricaFile(file: File) {
    setErrore(null);
    start(async () => {
      const prep = await preparaUploadAccordoTecnico(c.id, file.name);
      if (!prep.ok) {
        setErrore(prep.errore);
        return;
      }
      const supabase = supabaseBrowser();
      const { error } = await supabase.storage
        .from(prep.dati.bucket)
        .uploadToSignedUrl(prep.dati.path, prep.dati.token, file);
      if (error) {
        setErrore("Caricamento non riuscito: " + error.message);
        return;
      }
      const esito = await caricaAccordoTecnico(c.id, prep.dati.path);
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      onCambiato();
    });
  }

  const verificata = !!c.accordo_path;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {c.accordo_sha256 && (
          <button
            onClick={copiaHash}
            title="Copia l'impronta"
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-xs hover:border-slate-300 ${
              verificata ? "border-slate-200 text-slate-500" : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {c.accordo_sha256.slice(0, 16)}… {copiato ? "✓ copiato" : "copia"}
          </button>
        )}
        <label className="tt-btn inline-flex cursor-pointer items-center border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
          {pending ? "Carico…" : c.accordo_path ? "Sostituisci scansione" : "Carica scansione firmata"}
          <input
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) caricaFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {c.accordo_sha256 && !verificata && (
        <p className="mt-1 text-xs text-amber-700">
          Impronta non verificata dal server (nessuna scansione caricata):
          carica il file per confermarla.
        </p>
      )}
      {errore && <p className="mt-1 text-xs text-red-600">{errore}</p>}
    </div>
  );
}

function RegistroAccessi({
  collaboratoreId,
  accessi,
  onCambiato,
}: {
  collaboratoreId: string;
  accessi: CollaboratoreTecnico["collaboratori_tecnici_accessi"];
  onCambiato: () => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [sistema, setSistema] = useState("");
  const [livello, setLivello] = useState("");
  const [concessoIl, setConcessoIl] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function aggiungi() {
    start(async () => {
      setErrore(null);
      const esito = await aggiungiAccessoTecnico(collaboratoreId, { sistema, livello, concessoIl, note });
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setSistema("");
      setLivello("");
      setNote("");
      setAperto(false);
      onCambiato();
    });
  }

  function revoca(accessoId: string) {
    start(async () => {
      const esito = await aggiornaAccessoTecnico(accessoId, {
        revocato_il: new Date().toISOString().slice(0, 10),
      });
      if (esito.ok) onCambiato();
    });
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Registro degli accessi (Allegato 1)</h3>
        <button
          onClick={() => setAperto((v) => !v)}
          className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          + Concedi accesso
        </button>
      </div>

      {aperto && (
        <div className="mt-2 grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <input
            value={sistema}
            onChange={(e) => setSistema(e.target.value)}
            placeholder="Sistema (es. Supabase, Vercel, Make.com)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={livello}
            onChange={(e) => setLivello(e.target.value)}
            placeholder="Livello (es. lettura, scrittura, admin)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={concessoIl}
            onChange={(e) => setConcessoIl(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (facoltative)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {errore && <p className="sm:col-span-2 text-xs text-red-600">{errore}</p>}
          <div className="sm:col-span-2 flex gap-2">
            <button
              onClick={aggiungi}
              disabled={pending || !sistema.trim() || !livello.trim()}
              className="tt-btn bg-tt-ink px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {pending ? "Salvo…" : "Salva accesso"}
            </button>
          </div>
        </div>
      )}

      {accessi.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">Nessun accesso registrato.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
          {accessi.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span>
                <strong>{a.sistema}</strong> — {a.livello} · concesso il {dataIt(a.concesso_il)}
                {a.revocato_il && ` · revocato il ${dataIt(a.revocato_il)}`}
                {a.note && ` · ${a.note}`}
              </span>
              {!a.revocato_il && (
                <button
                  onClick={() => revoca(a.id)}
                  disabled={pending}
                  className="tt-btn border border-red-200 bg-white px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Revoca
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SezioneRinnovo({
  collaboratore: c,
  onCambiato,
}: {
  collaboratore: CollaboratoreTecnico;
  onCambiato: () => void;
}) {
  const [errore, setErrore] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function caricaFile(file: File) {
    setErrore(null);
    setMessaggio(null);
    start(async () => {
      const prep = await preparaUploadRinnovoTecnico(c.id, file.name);
      if (!prep.ok) {
        setErrore(prep.errore);
        return;
      }
      const supabase = supabaseBrowser();
      const { error } = await supabase.storage
        .from(prep.dati.bucket)
        .uploadToSignedUrl(prep.dati.path, prep.dati.token, file);
      if (error) {
        setErrore("Caricamento non riuscito: " + error.message);
        return;
      }
      const esito = await caricaRinnovoTecnico(c.id, prep.dati.path);
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      onCambiato();
    });
  }

  function approva() {
    start(async () => {
      setErrore(null);
      const esito = await approvaRinnovoTecnico(c.id);
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setMessaggio(
        `Rinnovo approvato: nuova scadenza ${esito.dati.nuovaScadenza.replaceAll("-", "/")}, PEC/email inviata.`,
      );
      onCambiato();
    });
  }

  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold">Rinnovo</h3>
      {errore && <p className="mt-1 text-xs text-red-600">{errore}</p>}
      {messaggio && <p className="mt-1 text-xs text-emerald-700">{messaggio}</p>}

      {c.rinnovo_path ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">
            Documento di rinnovo caricato il {dataIt(c.rinnovo_caricato_at)}, in attesa di approvazione.
          </span>
          <button
            onClick={approva}
            disabled={pending}
            className="tt-btn bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? "Approvo…" : "Approva rinnovo"}
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <label className="tt-btn inline-flex cursor-pointer items-center border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            {pending ? "Carico…" : "Carica documento di rinnovo firmato"}
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) caricaFile(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
