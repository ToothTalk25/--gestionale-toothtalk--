"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import { aggiornaAnagrafica, caricaAccordo, caricaFoto, registraConsenso, revocaConsenso, esportaDatiPersonali } from "@/app/actions-profilo";
import type { Profile } from "@/lib/types";
import FotoProfilo from "@/components/FotoProfilo";

function sanifica(nome: string) {
  return nome.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
}

export default function ProfiloPersonale({
  profile,
  isAdmin,
}: {
  profile: Profile;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const [universita, setUniversita] = useState(profile.universita ?? "");
  const [pec, setPec] = useState(profile.pec ?? "");

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
  const [verificaStato, setVerificaStato] = useState<{
    esito: string | null;
    note: string | null;
  }>({ esito: profile.accordo_verificato, note: profile.accordo_verifica_note });

  // Consenso riconoscimento foto
  const [consensoRiconoscimento, setConsensoRiconoscimento] = useState(false);
  const [consensoCaricato, setConsensoCaricato] = useState(false);
  const [messaggioRevoca, setMessaggioRevoca] = useState<string | null>(null);
  const [erroreRevoca, setErroreRevoca] = useState<string | null>(null);
  const [revocaInCorso, setRevocaInCorso] = useState(false);

  async function revoca(tipo: "privacy" | "cookie") {
    const ok = window.confirm(
      "Revocare il consenso " +
        (tipo === "privacy" ? "alla privacy policy" : "alla cookie policy") +
        "? La revoca viene registrata (chi, quando) e non è retroattiva. Non tocca le liberatorie firmate e i materiali già depositati come prova legale.",
    );
    if (!ok) return;
    setRevocaInCorso(true);
    setErroreRevoca(null);
    setMessaggioRevoca(null);
    const esito = await revocaConsenso(tipo);
    setRevocaInCorso(false);
    if (!esito.ok) setErroreRevoca(esito.errore);
    else {
      setMessaggioRevoca(
        "Consenso " + (tipo === "privacy" ? "privacy" : "cookie") + " revocato. Il banner ricomparirà al prossimo accesso.",
      );
      router.refresh();
    }
  }

  async function esportaDati() {
    setErroreRevoca(null);
    setMessaggioRevoca(null);
    const esito = await esportaDatiPersonali();
    if (!esito.ok) {
      setErroreRevoca(esito.errore);
      return;
    }
    // Salva il JSON come file scaricabile (portabilità GDPR).
    const blob = new Blob([esito.dati.contenuto], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = esito.dati.nome;
    a.click();
    URL.revokeObjectURL(url);
    setMessaggioRevoca("File esportato: controlla i download del browser.");
  }

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

  function salvaAnagrafica() {
    setErrore(null);
    setMessaggio(null);
    start(async () => {
      const esito = await aggiornaAnagrafica({
        universita: universita || null,
        pec: pec || null,
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
        setVerificaStato({ esito: esito.dati.verifica.esito, note: esito.dati.verifica.note });
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

        <label className="mt-4 block text-sm font-medium">La tua PEC</label>
        <input
          type="email"
          value={pec}
          onChange={(e) => setPec(e.target.value)}
          placeholder="nome@pec.it"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {!profile.pec && (
          <p className="mt-1 text-xs text-amber-700">
            Obbligatoria: l&apos;accordo e le impronte ti arriveranno via PEC con
            valore certificato.
          </p>
        )}

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
        {/* -------------------------------------------------------- foto
            Solo per i partecipanti: la foto serve ai compagni di gruppo per
            riconoscersi. Chi ha accesso globale non ha bisogno di una foto. */}
        {!isAdmin && (
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
        )}

        {/* ------------------------------------------- consensi e privacy */}
        <section className="rounded-2xl bg-white p-6 ring-1 ring-black/5">
          <h2 className="text-lg font-medium">Consensi e privacy</h2>
          <p className="mt-1 text-sm text-slate-500">
            Puoi revocare in qualsiasi momento il consenso alla privacy e
            alla cookie policy: la revoca viene registrata (chi e quando) e
            non è retroattiva. Non tocca le liberatorie firmate e i
            materiali già depositati come prova legale.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => revoca("privacy")}
              disabled={revocaInCorso}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Revoca consenso privacy
            </button>
            <button
              onClick={() => revoca("cookie")}
              disabled={revocaInCorso}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              Revoca consenso cookie
            </button>
            <button
              onClick={esportaDati}
              disabled={revocaInCorso}
              className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
            >
              Esporta i miei dati (GDPR)
            </button>
          </div>
          {messaggioRevoca && (
            <p className="mt-3 text-xs text-emerald-700">{messaggioRevoca}</p>
          )}
          {erroreRevoca && (
            <p className="mt-3 text-xs text-red-600">{erroreRevoca}</p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Informative:{" "}
            <Link href="/privacy" className="text-tt-blue underline">
              privacy policy
            </Link>{" "}
            e{" "}
            <Link href="/privacy#cookie" className="text-tt-blue underline">
              cookie policy
            </Link>
            .
          </p>
        </section>

        {/* ----------------------------------------------------- accordo
            Solo per i partecipanti: chi ha accesso globale stipula i contratti,
            non li carica — la sua PEC è già il mittente delle comunicazioni. */}
        {!isAdmin && (
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

          {verificaStato.esito && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
              <p className="font-medium">
                Controllo IA:{" "}
                {verificaStato.esito === "ok" && (
                  <span className="text-emerald-700">accordo valido e firmato ✓</span>
                )}
                {verificaStato.esito === "attenzione" && (
                  <span className="text-amber-700">attenzione — verifica manuale</span>
                )}
                {verificaStato.esito === "errato" && (
                  <span className="text-red-700">sembra non corretto</span>
                )}
                {verificaStato.esito === "non_valutato" && (
                  <span className="text-slate-500">non valutato</span>
                )}
              </p>
              {verificaStato.note && (
                <p className="mt-1 text-slate-500">{verificaStato.note}</p>
              )}
            </div>
          )}
        </section>
        )}
      </div>

      {messaggio && <p className="text-sm text-emerald-700 lg:col-span-2">{messaggio}</p>}
      {errore && <p className="text-sm text-red-600 lg:col-span-2">{errore}</p>}
    </div>
  );
}
