"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import { aggiornaAnagrafica, caricaAccordo, caricaFoto } from "@/app/actions-profilo";
import type { Profile } from "@/lib/types";
import FotoProfilo from "@/components/FotoProfilo";

function sanifica(nome: string) {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

export default function ProfiloPersonale({
  profile,
}: {
  profile: Profile;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const [universita, setUniversita] = useState(profile.universita ?? "");

  const fotoInput = useRef<HTMLInputElement>(null);
  const accordoInput = useRef<HTMLInputElement>(null);
  const [fotoPath, setFotoPath] = useState(profile.foto_path ?? "");
  const [accordoStato, setAccordoStato] = useState<string | null>(
    profile.accordo_path
      ? profile.accordo_caricato_at
        ? `Caricato il ${new Date(profile.accordo_caricato_at).toLocaleString("it-IT")}`
        : "Caricato"
      : null,
  );
  const [pecStato, setPecStato] = useState<string | null>(null);

  function salvaAnagrafica() {
    setErrore(null);
    setMessaggio(null);
    start(async () => {
      const esito = await aggiornaAnagrafica({
        universita: universita || null,
      });
      if (!esito.ok) setErrore(esito.errore);
      else {
        setMessaggio("Dati salvati.");
        router.refresh();
      }
    });
  }

  async function caricaFile(ref: React.RefObject<HTMLInputElement | null>, tipo: "foto" | "accordo") {
    const file = ref.current?.files?.[0];
    if (!file) return;
    setErrore(null);
    setMessaggio(null);
    try {
      const sha = await sha256File(file);
      const { data: auth } = await supabaseBrowser().auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");

      const path = `${uid}/${tipo}/${crypto.randomUUID()}__${sanifica(file.name)}`;
      const { error } = await supabaseBrowser()
        .storage.from("profili")
        .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (error) throw new Error(error.message);

      if (tipo === "foto") {
        const esito = await caricaFoto(path);
        if (!esito.ok) throw new Error(esito.errore);
        setFotoPath(path);
        setMessaggio("Foto aggiornata.");
      } else {
        const esito = await caricaAccordo(path, sha);
        if (!esito.ok) {
          setAccordoStato("Caricato, PEC non partita");
          throw new Error(esito.errore);
        }
        setAccordoStato(`Caricato il ${new Date().toLocaleString("it-IT")}`);
        setPecStato(`PEC inviata (${esito.dati.messageId})`);
        setMessaggio("Accordo caricato e inviato via PEC con data certa.");
      }
      if (ref.current) ref.current.value = "";
      router.refresh();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore imprevisto");
    }
  }


  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* -------------------------------------------------- anagrafica */}
      <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
        <h2 className="text-lg font-medium">Anagrafica</h2>
        <p className="mt-1 text-sm text-slate-500">{profile.email}</p>

        <label className="mt-5 block text-sm font-medium">Nome e cognome</label>
        <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          {profile.full_name ?? "—"}
        </p>

        <label className="mt-4 block text-sm font-medium">Università</label>
        <input
          value={universita}
          onChange={(e) => setUniversita(e.target.value)}
          placeholder="Es. Università degli Studi di Messina"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />

        <p className="mt-3 text-xs text-slate-400">
          Studenti e studentesse di odontoiatria: l'università basta a
          identificarvi.
        </p>

        <button
          onClick={salvaAnagrafica}
          className="mt-5 rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white"
        >
          Salva dati
        </button>
      </section>

      <div className="space-y-6">
        {/* -------------------------------------------------------- foto */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-lg font-medium">Foto</h2>
          <p className="mt-1 text-sm text-slate-500">
            La foto che ti identifica nel gruppo.
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
            onChange={() => caricaFile(fotoInput, "foto")}
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

        {/* ----------------------------------------------------- accordo */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-lg font-medium">Accordo editoriale</h2>
          <p className="mt-1 text-sm text-slate-500">
            Carica il PDF firmato dell'accordo: verrà inviato automaticamente
            via PEC a chi ha accesso globale, con data certa e copia alla tua
            casella.
          </p>
          {accordoStato && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {accordoStato}
            </p>
          )}
          {pecStato && (
            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {pecStato}
            </p>
          )}
          <input
            ref={accordoInput}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={() => caricaFile(accordoInput, "accordo")}
          />
          <button
            onClick={() => accordoInput.current?.click()}
            className="mt-4 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          >
            {accordoStato ? "Sostituisci accordo" : "Carica accordo"}
          </button>
        </section>
      </div>

      {messaggio && <p className="text-sm text-emerald-700 lg:col-span-2">{messaggio}</p>}
      {errore && <p className="text-sm text-red-600 lg:col-span-2">{errore}</p>}
    </div>
  );
}
