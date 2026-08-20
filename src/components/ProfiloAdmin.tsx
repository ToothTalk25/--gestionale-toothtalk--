"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { aggiornaAnagrafica, caricaFoto, registraConsenso } from "@/app/actions-profilo";
import type { Profile } from "@/lib/types";
import FotoProfilo from "@/components/FotoProfilo";

function sanifica(nome: string) {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Profilo dell'Admin (Titolare). L'admin non compila un accordo — gestisce
 * il progetto dal Registro. Ha però una foto come gli altri membri: il
 * Titolare è anche membro del team del proprio polo, e la foto serve ai
 * compagni di gruppo per riconoscersi negli stessi punti dell'app in cui
 * vedono le foto degli altri.
 */
export default function ProfiloAdmin({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [pec, setPec] = useState(profile.pec ?? "");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, start] = useTransition();

  const fotoInput = useRef<HTMLInputElement>(null);
  const [fotoPath, setFotoPath] = useState(profile.foto_path ?? "");
  const [consensoRiconoscimento, setConsensoRiconoscimento] = useState(false);
  const [consensoCaricato, setConsensoCaricato] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabaseBrowser().auth.getUser();
      if (!auth.user) return;
      const { data } = await supabaseBrowser()
        .from("consensi")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("tipo", "riconoscimento_foto")
        .limit(1);
      setConsensoRiconoscimento((data ?? []).length > 0);
      setConsensoCaricato(true);
    })();
  }, []);

  async function daiConsensoRiconoscimento() {
    const esito = await registraConsenso("riconoscimento_foto");
    if (esito.ok) setConsensoRiconoscimento(true);
  }

  async function caricaFotoFile() {
    const file = fotoInput.current?.files?.[0];
    if (!file) return;
    setErrore(null);
    setMessaggio(null);
    try {
      const { data: auth } = await supabaseBrowser().auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");

      const path = `${uid}/foto/${crypto.randomUUID()}__${sanifica(file.name)}`;
      const { error } = await supabaseBrowser()
        .storage.from("profili")
        .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (error) throw new Error(error.message);

      const esito = await caricaFoto(path);
      if (!esito.ok) throw new Error(esito.errore);
      setFotoPath(path);
      setMessaggio("Foto aggiornata.");
      if (fotoInput.current) fotoInput.current.value = "";
      router.refresh();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore imprevisto");
    }
  }

  function salva() {
    setErrore(null);
    setMessaggio(null);
    start(async () => {
      const esito = await aggiornaAnagrafica({ pec: pec.trim() || null });
      if (!esito.ok) {
        setErrore(esito.errore);
        return;
      }
      setMessaggio("Recapito aggiornato.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ------------------------------------------------ anagrafica */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">I miei dati</h2>
        <p className="mt-1 text-sm text-slate-500">{profile.email}</p>

        <label className="mt-5 block text-sm font-medium">Nome e cognome</label>
        <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {profile.full_name ?? "—"}
        </p>

        <label className="mt-4 block text-sm font-medium">
          Email o PEC di contatto
        </label>
        <input
          type="email"
          value={pec}
          onChange={(e) => setPec(e.target.value)}
          placeholder="nome@pec.it"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">
          Usata come recapito di cortesia. Per le comunicazioni ufficiali il
          sistema usa la PEC del progetto configurata lato server.
        </p>

        {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
        {messaggio && <p className="mt-3 text-sm text-emerald-700">{messaggio}</p>}

        <button
          onClick={salva}
          disabled={inCorso}
          className="mt-4 rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {inCorso ? "Salvo…" : "Salva"}
        </button>
      </section>

      {/* -------------------------------------------------------- foto
          Anche il Titolare fa parte di un team di polo: la foto serve ai
          compagni di gruppo per riconoscerlo negli stessi punti dell'app
          in cui vedono le foto degli altri membri. */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Foto</h2>
        <p className="mt-1 text-sm text-slate-500">
          La foto che ti identifica nel team.
        </p>

        <div className="mt-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-2 ring-black/10">
          {fotoPath ? (
            <FotoProfilo path={fotoPath} className="h-full w-full object-cover" alt="Foto profilo" />
          ) : (
            <span className="text-xs text-slate-400">Nessuna foto</span>
          )}
        </div>

        <input
          ref={fotoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={caricaFotoFile}
        />
        <button
          onClick={() => fotoInput.current?.click()}
          className="mt-4 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        >
          {fotoPath ? "Sostituisci foto" : "Carica foto"}
        </button>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Formati accettati: JPG, PNG o WebP. Dimensione massima 5 MB,
          consigliata quadrata e almeno 400×400 px.
        </p>

        {consensoCaricato && fotoPath && (
          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={consensoRiconoscimento}
              onChange={() => !consensoRiconoscimento && daiConsensoRiconoscimento()}
              disabled={consensoRiconoscimento}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-xs text-slate-600 leading-relaxed">
              {consensoRiconoscimento
                ? "Hai autorizzato l'uso di questa foto per il controllo automatico."
                : "Autorizzo l'uso di questa foto per il controllo automatico che verifica se un video mostra persone esterne al progetto."}
            </span>
          </label>
        )}
      </section>

      {/* ------------------------------------------- strumenti admin */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Strumenti del Titolare</h2>
        <p className="mt-1 text-sm text-slate-500">
          Da qui raggiungi le aree di amministrazione del progetto.
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>
            <a href="/admin" className="text-tt-blue hover:underline">
              → Registro globale (partecipanti, consensi, accordi, log)
            </a>
          </li>
          <li>
            <a href="/revisione" className="text-tt-blue hover:underline">
              → Video da rivedere
            </a>
          </li>
          <li>
            <a href="/dashboard" className="text-tt-blue hover:underline">
              → Progetti (vista globale)
            </a>
          </li>
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          Ruolo: <span className="font-medium text-slate-600">admin</span> ·
          accesso globale a tutti i gruppi.
        </p>
      </section>
    </div>
  );
}
