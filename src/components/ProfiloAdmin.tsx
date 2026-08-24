"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { aggiornaAnagrafica, caricaFoto } from "@/app/actions-profilo";
import type { Profile } from "@/lib/types";
import FotoProfilo from "@/components/FotoProfilo";

function sanifica(nome: string) {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

/**
 * Profilo dell'Admin (Coordinatore). L'admin non compila un accordo —
 * gestisce il progetto dal Registro. Ha però una foto come gli altri
 * membri: il Coordinatore è anche membro del team del proprio polo, e la
 * foto serve ai compagni di gruppo per riconoscersi negli stessi punti
 * dell'app in cui vedono le foto degli altri.
 */
export default function ProfiloAdmin({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [pec, setPec] = useState(profile.pec ?? "");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, start] = useTransition();

  const fotoInput = useRef<HTMLInputElement>(null);
  const [fotoPath, setFotoPath] = useState(profile.foto_path ?? "");

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
      <section className="tt-card p-6">
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
          className="tt-btn mt-4 bg-tt-ink px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
        >
          {inCorso ? "Salvo…" : "Salva"}
        </button>
      </section>

      {/* -------------------------------------------------------- foto
          Anche il Coordinatore fa parte di un team di polo: la foto serve
          ai compagni di gruppo per riconoscerlo negli stessi punti
          dell'app in cui vedono le foto degli altri membri. */}
      <section className="tt-card p-6">
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
      </section>
    </div>
  );
}
