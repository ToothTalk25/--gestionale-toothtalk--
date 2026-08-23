"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import {
  aggiornaAnagrafica,
  caricaAccordo,
  caricaFoto,
  revocaConsenso,
  revocaImmagineVoce,
  esportaDatiPersonali,
  scaricaDocumentoNomina,
} from "@/app/actions-profilo";
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
  const [dataNascita, setDataNascita] = useState(profile.data_nascita ?? "");
  const [luogoNascita, setLuogoNascita] = useState(profile.luogo_nascita ?? "");
  const [codiceFiscale, setCodiceFiscale] = useState(profile.codice_fiscale ?? "");
  const [nominaMessaggio, setNominaMessaggio] = useState<string | null>(null);

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
  const [accordoLetto, setAccordoLetto] = useState(false);
  const [verificaStato, setVerificaStato] = useState<{
    esito: string | null;
    note: string | null;
  }>({ esito: profile.accordo_verificato, note: profile.accordo_verifica_note });

  const [messaggioRevoca, setMessaggioRevoca] = useState<string | null>(null);
  const [erroreRevoca, setErroreRevoca] = useState<string | null>(null);
  const [revocaInCorso, setRevocaInCorso] = useState(false);

  const [revocaImmagineAperta, setRevocaImmagineAperta] = useState(false);
  const [chiediRimozionePubblicato, setChiediRimozionePubblicato] = useState(false);
  const [revocaImmagineInCorso, setRevocaImmagineInCorso] = useState(false);

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

  async function confermaRevocaImmagine() {
    const ok = window.confirm(
      "Revocare il consenso a immagine e voce?\n\n" +
        "Il materiale grezzo non ancora pubblicato che ti ritrae verrà " +
        "individuato ed eliminato dal Coordinatore entro 30 giorni, previa " +
        "verifica di quali file ti ritraggono davvero — non è una " +
        "cancellazione automatica." +
        (chiediRimozionePubblicato
          ? "\n\nHai anche chiesto la rimozione dei contenuti già pubblicati: " +
            "si apre una richiesta che il Titolare valuta entro 30 giorni " +
            "(prorogabili a 90) — non viene rimosso nulla in automatico."
          : "\n\nI contenuti già pubblicati restano online, a meno che tu non " +
            "chieda anche la loro rimozione qui sopra.") +
        "\n\nQuesto NON incide sulla tua partecipazione al progetto: puoi " +
        "restare come Collaboratore anche dopo la revoca.\n\nConfermi?",
    );
    if (!ok) return;
    setRevocaImmagineInCorso(true);
    setErroreRevoca(null);
    setMessaggioRevoca(null);
    const esito = await revocaImmagineVoce(chiediRimozionePubblicato);
    setRevocaImmagineInCorso(false);
    if (!esito.ok) {
      setErroreRevoca(esito.errore);
      return;
    }
    setMessaggioRevoca(
      "Consenso a immagine/voce revocato. Il Coordinatore individuerà ed eliminerà il materiale grezzo che ti ritrae entro 30 giorni." +
        (esito.dati.richiestaRimozioneAperta
          ? " Richiesta di rimozione del pubblicato aperta: il Titolare la valuterà entro i termini di legge."
          : ""),
    );
    setRevocaImmagineAperta(false);
    setChiediRimozionePubblicato(false);
    router.refresh();
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

  function salvaAnagrafica() {
    setErrore(null);
    setMessaggio(null);
    start(async () => {
      const esito = await aggiornaAnagrafica({
        universita: universita || null,
        pec: pec || null,
        data_nascita: dataNascita || null,
        luogo_nascita: luogoNascita || null,
        codice_fiscale: codiceFiscale || null,
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
    if (tipo === "accordo" && !accordoLetto) {
      setErrore("Devi prima spuntare di aver letto e compreso l'accordo editoriale.");
      if (ref.current) ref.current.value = "";
      return;
    }
    if (tipo === "accordo" && (!dataNascita || !luogoNascita || !codiceFiscale)) {
      setErrore(
        "Completa e salva prima data di nascita, luogo di nascita e codice fiscale nella scheda Anagrafica.",
      );
      if (ref.current) ref.current.value = "";
      return;
    }
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
        const esito = await caricaAccordo(path, sha, accordoLetto);
        if (!esito.ok) {
          setAccordoStato("Caricato, PEC non partita");
          throw new Error(esito.errore);
        }
        setAccordoStato(`Caricato il ${new Date().toLocaleString("it-IT")}`);
        setPecStato(`PEC inviata (${esito.dati.messageId})`);
        setVerificaStato({ esito: esito.dati.verifica.esito, note: esito.dati.verifica.note });
        setMessaggio("Accordo caricato e inviato via PEC con data certa.");
        // Ogni nuovo caricamento richiede una nuova conferma esplicita.
        setAccordoLetto(false);
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

        <label className="mt-4 block text-sm font-medium">Email o PEC (facoltativa)</label>
        <input
          type="email"
          value={pec}
          onChange={(e) => setPec(e.target.value)}
          placeholder="nome@pec.it"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-slate-400">
          Facoltativa: serve solo se vuoi ricevere con valore di consegna
          certificata le comunicazioni (accordo, impronte). Una PEC vera dà
          la certificazione in più, ma non è richiesta per partecipare.
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

        {!isAdmin && (
          <>
            <label className="mt-4 block text-sm font-medium">Data di nascita</label>
            <input
              type="date"
              value={dataNascita}
              onChange={(e) => setDataNascita(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mt-4 block text-sm font-medium">Luogo di nascita</label>
            <input
              value={luogoNascita}
              onChange={(e) => setLuogoNascita(e.target.value)}
              placeholder="Es. Genova"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mt-4 block text-sm font-medium">Codice fiscale</label>
            <input
              value={codiceFiscale}
              onChange={(e) => setCodiceFiscale(e.target.value.toUpperCase())}
              placeholder="RSSMRA00A01F205X"
              maxLength={16}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
            />
            <p className="mt-1 text-xs text-slate-400">
              Questi tre dati servono a compilare il Modulo di nomina
              individuale (Documento 4), generato automaticamente quando il
              tuo accordo viene approvato: senza, non puoi caricare
              l&apos;accordo.
            </p>
          </>
        )}

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
            <Link href="/privacy?from=app" className="text-tt-blue underline">
              privacy policy
            </Link>{" "}
            e{" "}
            <Link href="/privacy?from=app#cookie" className="text-tt-blue underline">
              cookie policy
            </Link>
            .
          </p>

          {/* ------------------------------------- immagine e voce (on-screen)
              Atto indipendente dal recesso: uscire dal progetto non revoca
              questo consenso, e revocarlo non ti fa uscire dal progetto. */}
          {profile.on_screen && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-700">
                Consenso a immagine e voce nei contenuti
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Indipendente dalla tua partecipazione al progetto: puoi
                revocarlo restando Collaboratore, e puoi restare Collaboratore
                senza revocarlo.
              </p>

              {!revocaImmagineAperta ? (
                <button
                  onClick={() => setRevocaImmagineAperta(true)}
                  className="mt-3 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
                >
                  Revoca consenso a immagine e voce
                </button>
              ) : (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800">
                    Il materiale grezzo non ancora pubblicato che ti ritrae
                    verrà individuato ed eliminato dal Coordinatore entro 30
                    giorni, previa verifica di quali file ti ritraggono
                    davvero — non è una cancellazione automatica. I contenuti
                    già pubblicati restano online, a meno che tu non chieda
                    anche la loro rimozione qui sotto — in quel caso si apre
                    una richiesta valutata dal Titolare, non una rimozione
                    automatica.
                  </p>
                  <label className="mt-3 flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chiediRimozionePubblicato}
                      onChange={(e) => setChiediRimozionePubblicato(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-xs text-amber-900">
                      Chiedo anche la rimozione dei contenuti già pubblicati
                      che mi ritraggono.
                    </span>
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={confermaRevocaImmagine}
                      disabled={revocaImmagineInCorso}
                      className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {revocaImmagineInCorso ? "Revoco…" : "Conferma revoca"}
                    </button>
                    <button
                      onClick={() => {
                        setRevocaImmagineAperta(false);
                        setChiediRimozionePubblicato(false);
                      }}
                      disabled={revocaImmagineInCorso}
                      className="rounded-lg px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
            disabled={!accordoLetto || !dataNascita || !luogoNascita || !codiceFiscale}
            className="mt-4 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            {accordoStato ? "Sostituisci accordo" : "Carica accordo"}
          </button>
          {(!dataNascita || !luogoNascita || !codiceFiscale) && (
            <p className="mt-2 text-xs text-amber-700">
              Completa prima data e luogo di nascita e codice fiscale nella
              scheda Anagrafica (a sinistra) e salva: servono per il Modulo
              di nomina.
            </p>
          )}
          <label className="mt-3 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={accordoLetto}
              onChange={(e) => setAccordoLetto(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-xs text-slate-600 leading-relaxed">
              Ho letto e compreso tutto ciò che è scritto all&apos;interno
              dell&apos;accordo editoriale e del Protocollo Operativo ad esso allegato.
            </span>
          </label>

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

          {/* ---- Checklist: le 4 condizioni per sbloccare i progetti ---- */}
          <div className="mt-4 rounded-lg border border-slate-200 p-3 text-xs">
            <p className="font-medium text-slate-700">Accesso ai progetti — stato</p>
            <ul className="mt-2 space-y-1 text-slate-600">
              <li className={profile.accordo_path ? "text-emerald-700" : "text-slate-400"}>
                {profile.accordo_path ? "☑" : "☐"} Accordo caricato
              </li>
              <li className={profile.accordo_letto_confermato ? "text-emerald-700" : "text-slate-400"}>
                {profile.accordo_letto_confermato ? "☑" : "☐"} Confermato &quot;ho letto e compreso&quot;
              </li>
              <li className={verificaStato.esito === "ok" ? "text-emerald-700" : "text-slate-400"}>
                {verificaStato.esito === "ok" ? "☑" : "☐"} Verifica IA superata
                {verificaStato.esito === "attenzione" && (
                  <span className="text-amber-700"> (attenzione: verifica manuale)</span>
                )}
                {verificaStato.esito === "errato" && (
                  <span className="text-red-700"> (sembra non corretto: ricarica)</span>
                )}
              </li>
              <li className={profile.accordo_approvato_admin_at ? "text-emerald-700" : "text-slate-400"}>
                {profile.accordo_approvato_admin_at ? "☑" : "☐"} Approvato dal Titolare
              </li>
            </ul>
            {(!profile.accordo_path ||
              !profile.accordo_letto_confermato ||
              verificaStato.esito !== "ok" ||
              !profile.accordo_approvato_admin_at) && (
              <p className="mt-2 text-slate-500">
                Il tuo accesso ai progetti resta bloccato finché l&apos;accordo non è
                completo su tutti questi punti.
              </p>
            )}
          </div>

          {/* ---- Modulo di nomina (Documento 4) — generato dal sistema alla
              approvazione dell'accordo, nessuna azione richiesta qui se non
              lo scaricarlo. ---- */}
          {profile.nomina_path && (
            <div className="mt-4 rounded-lg border border-slate-200 p-3 text-xs">
              <p className="font-medium text-slate-700">Modulo di nomina (Documento 4)</p>
              <p className="mt-1 text-slate-500">
                Generato automaticamente il{" "}
                {profile.nomina_generata_at
                  ? new Date(profile.nomina_generata_at).toLocaleString("it-IT")
                  : "—"}
                . Nessuna firma è richiesta da parte tua: è a tua disposizione
                per conoscenza e conservazione.
              </p>
              <button
                onClick={async () => {
                  // Apre subito una scheda vuota, prima dell'await: se si
                  // aspetta la risposta del server e si chiama window.open()
                  // solo dopo, il browser non la considera più legata al
                  // click dell'utente e la blocca in silenzio come popup.
                  const finestra = window.open("", "_blank");
                  setNominaMessaggio(null);
                  const esito = await scaricaDocumentoNomina();
                  if (!esito.ok) {
                    finestra?.close();
                    setNominaMessaggio(esito.errore);
                    return;
                  }
                  if (finestra) finestra.location.href = esito.dati;
                  else window.open(esito.dati, "_blank");
                }}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              >
                Scarica il modulo
              </button>
              {nominaMessaggio && (
                <p className="mt-2 text-red-600">{nominaMessaggio}</p>
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
