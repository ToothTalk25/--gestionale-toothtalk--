"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UploadDeliverable, { type UploadDeliverableHandle } from "@/components/UploadDeliverable";
import RegistraVideoDichiarazione from "@/components/RegistraVideoDichiarazione";
import ControlliAdminDichiarazione from "@/components/ControlliAdminDichiarazione";
import EsportazioneDrive from "@/components/EsportazioneDrive";
import { formatBytes } from "@/lib/hash";
import { IconaScarica, IconaSpinner } from "@/components/icone-azioni";
import { impostaCoinvolgeTerzi, urlFirmato } from "@/app/actions";
import { aggiornaContattoEsterno, aggiornaContattoPec, inviaRichiestaLiberatoria } from "@/app/actions-liberatoria";
import {
  annullaPacchetto,
  collegaElemento,
  importaTestoGoogleDoc,
  inviaPecPacchetto,
  rimandaInComposizione,
  rimuoviElementoPacchetto,
  salvaPacchetto,
  segnalaCompletato,
  segnalaErroreDichiarazione,
  sigillaPacchetto,
} from "@/app/actions-pacchetto";
import { archiviaFileFinale } from "@/app/actions";
import {
  PACCHETTO_LABEL,
  type EsportazioneDriveRow,
  type Formato,
  type PacchettoStato,
  type PacchettoVideoRow,
  type RuoloElemento,
} from "@/lib/types";

export type ElementoCaricato = {
  ruolo: RuoloElemento;
  version_id: string;
  file_name: string;
  sha256: string;
  size_bytes: number | null;
  uploaded_at: string;
  archiviato_esterno: boolean;
  /** Valorizzati solo per l'admin (pacchetto_elementi_meta): serve a costruire lo Scarica. */
  bucket: string | null;
  storage_path: string | null;
};

const COLORI: Record<PacchettoStato, string> = {
  bozza: "bg-slate-100 text-slate-700",
  pronto: "bg-violet-100 text-violet-800",
  sigillato: "bg-amber-100 text-amber-800",
  pec_inviata: "bg-blue-100 text-blue-800",
  pec_confermata: "bg-emerald-100 text-emerald-800",
  pec_errore: "bg-red-100 text-red-800",
  annullato: "bg-slate-200 text-slate-500 line-through",
};

export default function PacchettoVideo({
  taskId,
  pacchetto,
  elementi,
  isAdmin,
  locked,
  coinvolgeTerzi,
  esportazione,
  formato,
  contattoEsternoEmail,
  contattoEsternoPec,
  googleDocUrls,
  liberatoriaInfo,
  haRichiesteAperte,
}: {
  taskId: string;
  pacchetto: PacchettoVideoRow | null;
  elementi: ElementoCaricato[];
  isAdmin: boolean;
  locked: boolean;
  coinvolgeTerzi: boolean;
  esportazione: EsportazioneDriveRow | null;
  formato: Formato | null;
  contattoEsternoEmail: string | null;
  contattoEsternoPec: string | null;
  googleDocUrls: { script: string | null; descrizione: string | null; titoloYoutube: string | null };
  liberatoriaInfo: { stato: string; metodo_firma: string | null } | null;
  haRichiesteAperte: boolean;
}) {
  const router = useRouter();
  const [descrizione, setDescrizione] = useState(pacchetto?.descrizione ?? "");
  const [script, setScript] = useState(pacchetto?.script ?? "");
  const [titoloYoutube, setTitoloYoutube] = useState(
    pacchetto?.titolo_youtube ?? "",
  );
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [contattoEmail, setContattoEmail] = useState(contattoEsternoEmail ?? "");
  const [contattoPec, setContattoPec] = useState(contattoEsternoPec ?? "");
  const [testiConfermati, setTestiConfermati] = useState(false);
  const videoUploadRef = useRef<UploadDeliverableHandle>(null);
  const copertinaUploadRef = useRef<UploadDeliverableHandle>(null);
  const liberatoriaUploadRef = useRef<UploadDeliverableHandle>(null);
  const dichiarazioneUploadRef = useRef<UploadDeliverableHandle>(null);
  const dichiarazioneIntegrazioneUploadRef = useRef<UploadDeliverableHandle>(null);

  const stato = pacchetto?.stato ?? "bozza";
  const inBozza = stato === "bozza";
  // Il pacchetto lo compone il gruppo, non chi ha accesso globale: è il loro deposito, e
  // la RLS rifiuterebbe comunque una consegna "originale" fatta dall'Admin.
  const componibile = inBozza && !locked && !isAdmin;
  // Il contatto per la liberatoria non è un file "originale" soggetto a RLS:
  // può correggerlo anche l'Admin (es. refuso nell'email), non solo il gruppo.
  const contattoModificabile = inBozza && !locked;
  const archiviabile = isAdmin && (stato === "sigillato" || stato === "pec_inviata" || stato === "pec_confermata");

  const video = elementi.find((e) => e.ruolo === "video");
  const copertina = elementi.find((e) => e.ruolo === "copertina");
  const liberatoria = elementi.find((e) => e.ruolo === "liberatoria");
  const dichiarazione = elementi.find((e) => e.ruolo === "dichiarazione_identita");
  const dichiarazioneIntegrazione = elementi.find((e) => e.ruolo === "dichiarazione_integrazione");
  const liberatoriaOtp = liberatoriaInfo?.metodo_firma === "otp";
  const completo =
    !!video &&
    !!copertina &&
    descrizione.trim() !== "" &&
    script.trim() !== "" &&
    titoloYoutube.trim() !== "" &&
    !haRichiesteAperte &&
    (!coinvolgeTerzi || (!!liberatoria && liberatoriaOtp)) &&
    (!coinvolgeTerzi || !!dichiarazione);

  // Lo script cambia a seconda del formato scelto alla creazione del
  // progetto: il titolo, la nota e il placeholder spiegano cosa ci si
  // aspetta (narrazione integrale, domande, quiz…).
  const scriptTitolo =
    formato?.script_richiesto === "quiz" ? "3 · Domande del test" : "3 · Script usato";
  const scriptNota =
    formato?.istruzioni_script ?? "dev'essere ciò che si dice davvero nel video";
  const scriptPlaceholder = formato?.istruzioni_script
    ? `Es. ${formato.istruzioni_script.replace(/[.:]\s*$/, "")}…`
    : "Incolla qui il testo effettivamente pronunciato nel video…";

  async function assicuraPacchetto(): Promise<string | null> {
    if (pacchetto) return pacchetto.id;
    const esito = await salvaPacchetto(taskId, {});
    if (!esito.ok) {
      setErrore(esito.errore);
      return null;
    }
    return esito.dati.pacchettoId;
  }

  async function dopoUpload(ruolo: RuoloElemento, versionId: string) {
    const id = await assicuraPacchetto();
    if (!id) return;
    const esito = await collegaElemento(taskId, id, ruolo, versionId);
    if (!esito.ok) setErrore(esito.errore);
    else router.refresh();
  }

  function rimuovi(ruolo: RuoloElemento) {
    if (!pacchetto) return;
    start(async () => {
      setErrore(null);
      setMessaggio(null);
      const esito = await rimuoviElementoPacchetto(taskId, pacchetto.id, ruolo);
      if (!esito.ok) setErrore(esito.errore);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-2xl bg-white p-6 ring-2 ring-tt-ink/10">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
        <div className="flex-1">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Video completo</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Gli elementi che finiranno sui social
            {coinvolgeTerzi ? " (compresa la liberatoria)" : ""}. Quando sono
            tutti presenti il pacchetto si <strong>sigilla</strong> e parte via
            PEC, con copia a chi ha realizzato il video: quella ricevuta dà
            data certa al contenuto.{" "}
            <strong>Descrizione e script viaggiano sempre integrali</strong> —
            sono testo, non pesano, e lo script è la trascrizione di ciò che il
            video dice. I materiali di lavorazione qui sopra restano fuori da
            questa attestazione.
          </p>
        </div>
        <span
          className={`rounded-full px-[11px] py-[3px] text-xs font-semibold ${COLORI[stato]}`}
        >
          {PACCHETTO_LABEL[stato]}
        </span>
      </div>

      {/* -------------------------------------------------- persone terze */}
      <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
        <input
          type="checkbox"
          checked={coinvolgeTerzi}
          disabled={!componibile}
          onChange={(e) =>
            start(async () => {
              setErrore(null);
              const esito = await impostaCoinvolgeTerzi(taskId, e.target.checked);
              if (!esito.ok) setErrore(esito.errore);
              else router.refresh();
            })
          }
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-medium">Il video mostra una persona esterna al progetto</span>
          <span className="block text-xs text-slate-500">
            Es. un&apos;intervista o un passante. Se selezionato, la liberatoria
            diventa obbligatoria. Inserisci sotto l&apos;email del contatto: chi
            ha accesso globale invierà un link sicuro per caricare il modulo
            firmato.
          </span>
        </span>
      </label>

      {coinvolgeTerzi && (
        <div className="mt-3 space-y-3 rounded-xl border border-slate-200 p-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Email del contatto per la liberatoria
            </label>
            <input
              type="email"
              value={contattoEmail}
              disabled={!contattoModificabile}
              onChange={(e) => setContattoEmail(e.target.value)}
              onBlur={() => {
                if (contattoEmail.trim() !== (contattoEsternoEmail ?? "")) {
                  start(async () => {
                    setErrore(null);
                    const esito = await aggiornaContattoEsterno(
                      taskId,
                      contattoEmail.trim() || null,
                    );
                    if (!esito.ok) setErrore(esito.errore);
                    else router.refresh();
                  });
                }
              }}
              placeholder="es. studio@email.it"
              className="mt-1 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">
              PEC del contatto (opzionale — se presente, l'invito parte via PEC)
            </label>
            <input
              type="email"
              value={contattoPec}
              disabled={!contattoModificabile}
              onChange={(e) => setContattoPec(e.target.value)}
              onBlur={() => {
                if (contattoPec.trim() !== (contattoEsternoPec ?? "")) {
                  start(async () => {
                    const esito = await aggiornaContattoPec(
                      taskId,
                      contattoPec.trim() || null,
                    );
                    if (!esito.ok) setErrore(esito.errore);
                    else router.refresh();
                  });
                }
              }}
              placeholder="es. dottore@pec.it"
              className="mt-1 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          {isAdmin && (contattoEmail.trim() || contattoPec.trim()) && (
            <div className="flex items-center gap-2">
              <button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    setErrore(null);
                    setMessaggio(null);
                    const esito = await inviaRichiestaLiberatoria(
                      taskId,
                      contattoEmail.trim() || null,
                      contattoPec.trim() || null,
                    );
                    if (!esito.ok) setErrore(esito.errore);
                    else {
                      const via = esito.inviatoVia === "pec" ? " via PEC" : " via email";
                      setMessaggio(
                        "Link inviato" +
                          via +
                          " a " +
                          esito.destinatario +
                          (esito.avviso ? ` — ${esito.avviso}` : ""),
                      );
                    }
                  })
                }
                className="tt-btn bg-tt-blue px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
              >
                Invia link per la liberatoria
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- elementi */}
      <div className="mt-5 tt-card-piccola divide-y divide-slate-100 overflow-hidden">
        <Slot
          id="video"
          titolo="1 · Video montato"
          elemento={video}
          confermato={testiConfermati || !inBozza}
          onRimuovi={componibile && video ? () => rimuovi("video") : undefined}
          onDropFile={componibile ? (f) => videoUploadRef.current?.handleFile(f) : undefined}
          azione={
            componibile ? (
              <UploadDeliverable
                ref={videoUploadRef}
                taskId={taskId}
                kind="finale_video"
                archivio="finale"
                isAdmin={false}
                locked={locked}
                etichetta={video ? "Sostituisci" : "Carica video"}
                accept="video/*"
                onCaricato={(v) => dopoUpload("video", v)}
              >
                {!video && <p className="text-xs text-slate-400">Nessun file.</p>}
              </UploadDeliverable>
            ) : null
          }
          taskId={taskId}
          archiviabile={archiviabile}
          isAdmin={isAdmin}
        />
        <Slot
          id="copertina"
          titolo="2 · Copertina"
          elemento={copertina}
          confermato={testiConfermati || !inBozza}
          onRimuovi={
            componibile && copertina ? () => rimuovi("copertina") : undefined
          }
          onDropFile={componibile ? (f) => copertinaUploadRef.current?.handleFile(f) : undefined}
          azione={
            componibile ? (
              <UploadDeliverable
                ref={copertinaUploadRef}
                taskId={taskId}
                kind="finale_copertina"
                archivio="finale"
                isAdmin={false}
                locked={locked}
                etichetta={copertina ? "Sostituisci" : "Carica copertina"}
                accept="image/*"
                onCaricato={(v) => dopoUpload("copertina", v)}
              >
                {!copertina && <p className="text-xs text-slate-400">Nessun file.</p>}
              </UploadDeliverable>
            ) : null
          }
          taskId={taskId}
          archiviabile={archiviabile}
          isAdmin={isAdmin}
        />
        <Testo
          id="script"
          titolo={scriptTitolo}
          nota={scriptNota}
          valore={script}
          onChange={setScript}
          modificabile={componibile}
          confermato={testiConfermati || !inBozza}
          righe={8}
          placeholder={scriptPlaceholder}
          onImporta={
            googleDocUrls.script
              ? async () => {
                  const res = await importaTestoGoogleDoc(googleDocUrls.script!, "script");
                  if (res.ok) {
                    setScript(res.dati.testo);
                    if (res.dati.avvisi.length) setMessaggio(res.dati.avvisi.join(" · "));
                  } else setErrore(res.errore);
                }
              : undefined
          }
        />
        <Testo
          id="descrizione"
          titolo="4 · Descrizione da pubblicare"
          valore={descrizione}
          onChange={setDescrizione}
          modificabile={componibile}
          confermato={testiConfermati || !inBozza}
          righe={8}
          placeholder="La caption esatta che accompagnerà il video…"
          onImporta={
            googleDocUrls.descrizione
              ? async () => {
                  const res = await importaTestoGoogleDoc(googleDocUrls.descrizione!, "descrizione");
                  if (res.ok) {
                    setDescrizione(res.dati.testo);
                    if (res.dati.avvisi.length) setMessaggio(res.dati.avvisi.join(" · "));
                  } else setErrore(res.errore);
                }
              : undefined
          }
        />
        <Testo
          id="titolo_youtube"
          titolo="5 · Titolo per YouTube Shorts"
          nota="segui lo stile editoriale del canale: breve, accattivante"
          valore={titoloYoutube}
          onChange={setTitoloYoutube}
          modificabile={componibile}
          confermato={testiConfermati || !inBozza}
          righe={3}
          placeholder="Il titolo che comparirà sullo Short di YouTube…"
          onImporta={
            googleDocUrls.titoloYoutube
              ? async () => {
                  const res = await importaTestoGoogleDoc(googleDocUrls.titoloYoutube!, "titolo_youtube");
                  if (res.ok) {
                    setTitoloYoutube(res.dati.testo);
                    if (res.dati.avvisi.length) setMessaggio(res.dati.avvisi.join(" · "));
                  } else setErrore(res.errore);
                }
              : undefined
          }
        />

        {componibile && (
          <div className="px-5 py-4">
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErrore(null);
                  setMessaggio(null);
                  const esito = await salvaPacchetto(taskId, {
                    descrizione,
                    script,
                    titolo_youtube: titoloYoutube,
                  });
                  if (!esito.ok) setErrore(esito.errore);
                  else {
                    setMessaggio(
                      esito.dati.avvisi.length
                        ? esito.dati.avvisi.join(" · ")
                        : "Testi salvati.",
                    );
                    router.refresh();
                  }
                })
              }
              className="tt-btn border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Salva descrizione, script e titolo
            </button>
          </div>
        )}

        {coinvolgeTerzi && (
          <>
            {isAdmin ? (
              <Slot
                titolo="6 · Liberatoria privacy/immagine"
                elemento={liberatoria}
                confermato={testiConfermati || !inBozza}
                onRimuovi={
                  componibile && liberatoria ? () => rimuovi("liberatoria") : undefined
                }
                onDropFile={componibile ? (f) => liberatoriaUploadRef.current?.handleFile(f) : undefined}
                azione={
                  componibile ? (
                    <UploadDeliverable
                      ref={liberatoriaUploadRef}
                      taskId={taskId}
                      kind="finale_liberatoria"
                      archivio="finale"
                      isAdmin={false}
                      locked={locked}
                      etichetta={liberatoria ? "Sostituisci" : "Carica liberatoria"}
                      accept="application/pdf,image/*"
                      onCaricato={(v) => dopoUpload("liberatoria", v)}
                    >
                      {!liberatoria && <p className="text-xs text-slate-400">Nessun file.</p>}
                    </UploadDeliverable>
                  ) : null
                }
                taskId={taskId}
                archiviabile={archiviabile}
                isAdmin={isAdmin}
                footer={
                  <p className={`text-xs ${liberatoriaOtp ? "text-emerald-700" : "text-amber-700"}`}>
                    {liberatoriaOtp
                      ? "Liberatoria firmata via codice OTP ✓"
                      : "Attenzione: la liberatoria vale per il sigillo solo se firmata via codice OTP (non basta un caricamento manuale)."}
                  </p>
                }
              />
            ) : (
              <div className="px-5 py-4">
                <h3 className="text-sm font-medium">6 · Liberatoria privacy/immagine</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {liberatoria ? "Presente ✓ — il file non è visibile qui per motivi di privacy." : "Assente"}
                </p>
                {liberatoria && (
                  <p className={`mt-1 text-xs ${liberatoriaOtp ? "text-emerald-700" : "text-amber-700"}`}>
                    {liberatoriaOtp
                      ? "Firmata via codice OTP ✓"
                      : "Non ancora firmata via codice OTP: il sigillo richiede la firma sicura del contatto."}
                  </p>
                )}
              </div>
            )}

            <Slot
              id="dichiarazione"
              titolo="7 · Video di dichiarazione"
              elemento={dichiarazione}
              confermato={testiConfermati || !inBozza}
              onDropFile={
                componibile && !dichiarazione
                  ? (f) => dichiarazioneUploadRef.current?.handleFile(f)
                  : undefined
              }
              azione={
                componibile && !dichiarazione ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <RegistraVideoDichiarazione
                      onFileReady={(f) => dichiarazioneUploadRef.current?.handleFile(f)}
                    />
                    <p className="max-w-[220px] text-center text-[11px] text-slate-400">
                      Usa sempre prima questa opzione: durante l&apos;intervista
                      non serve uscire dalla pagina. Il caricamento file qui
                      sotto è solo la riserva per quando la registrazione
                      in-app non funziona.
                    </p>
                    <UploadDeliverable
                      ref={dichiarazioneUploadRef}
                      taskId={taskId}
                      kind="video_grezzo"
                      isAdmin={false}
                      locked={locked}
                      etichetta="Carica video di dichiarazione"
                      accept="video/*"
                      onCaricato={(v) => dopoUpload("dichiarazione_identita", v)}
                    >
                      {!dichiarazione && (
                        <p className="text-xs text-slate-400">Nessun file.</p>
                      )}
                    </UploadDeliverable>
                  </div>
                ) : null
              }
              taskId={taskId}
              archiviabile={false}
              isAdmin={isAdmin}
              footer={
                <>
                  {!isAdmin && (
                    <p className="text-xs text-slate-400">
                      Dopo la conferma resta visibile solo al Coordinatore: lo
                      hai già rivisto prima di caricarlo. Non è modificabile né
                      rimovibile: se è sbagliato, segnala l&apos;errore e il
                      Coordinatore libererà il campo.
                    </p>
                  )}
                  {dichiarazione && !isAdmin && pacchetto && (
                    <button
                      onClick={async () => {
                        const esito = await segnalaErroreDichiarazione(pacchetto.id, "dichiarazione_identita");
                        if (!esito.ok) window.alert(esito.errore);
                        else router.refresh();
                      }}
                      className="tt-btn mt-2 border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      Segnala errore (il video va ricaricato)
                    </button>
                  )}
                  {isAdmin && dichiarazione && pacchetto && (
                    <ControlliAdminDichiarazione
                      pacchettoId={pacchetto.id}
                      ruolo="dichiarazione_identita"
                    />
                  )}
                </>
              }
            />

            {/* Seconda parte della dichiarazione (Protocollo 4.1 "Domande non
                dichiarate"): il video di integrazione con la domanda aggiuntiva.
                Facoltativo, stessa riservatezza. */}
            <Slot
              id="dichiarazione-integrazione"
              titolo="7b · Video di integrazione della dichiarazione"
              elemento={dichiarazioneIntegrazione}
              confermato={testiConfermati || !inBozza}
              onDropFile={
                componibile && !dichiarazioneIntegrazione
                  ? (f) => dichiarazioneIntegrazioneUploadRef.current?.handleFile(f)
                  : undefined
              }
              azione={
                componibile && !dichiarazioneIntegrazione ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <RegistraVideoDichiarazione
                      onFileReady={(f) => dichiarazioneIntegrazioneUploadRef.current?.handleFile(f)}
                    />
                    <p className="max-w-[220px] text-center text-[11px] text-slate-400">
                      Usa sempre prima questa opzione: durante l&apos;intervista
                      non serve uscire dalla pagina. Il caricamento file qui
                      sotto è solo la riserva per quando la registrazione
                      in-app non funziona.
                    </p>
                    <UploadDeliverable
                      ref={dichiarazioneIntegrazioneUploadRef}
                      taskId={taskId}
                      kind="video_grezzo"
                      isAdmin={false}
                      locked={locked}
                      etichetta="Carica video di integrazione"
                      accept="video/*"
                      onCaricato={(v) => dopoUpload("dichiarazione_integrazione", v)}
                    >
                      {!dichiarazioneIntegrazione && (
                        <p className="text-xs text-slate-400">Nessun file.</p>
                      )}
                    </UploadDeliverable>
                  </div>
                ) : null
              }
              taskId={taskId}
              archiviabile={false}
              isAdmin={isAdmin}
              footer={
                <>
                  <p className="text-xs text-slate-400">
                    Da caricare solo se durante l&apos;intervista è stata posta una
                    domanda non dichiarata nel video iniziale (Protocollo Art.
                    4.1). Dopo la conferma è visibile solo al Coordinatore,
                    come la dichiarazione principale.
                  </p>
                  {dichiarazioneIntegrazione && !isAdmin && pacchetto && (
                    <button
                      onClick={async () => {
                        const esito = await segnalaErroreDichiarazione(pacchetto.id, "dichiarazione_integrazione");
                        if (!esito.ok) window.alert(esito.errore);
                        else router.refresh();
                      }}
                      className="tt-btn mt-2 border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      Segnala errore (il video va ricaricato)
                    </button>
                  )}
                  {isAdmin && dichiarazioneIntegrazione && pacchetto && (
                    <ControlliAdminDichiarazione
                      pacchettoId={pacchetto.id}
                      ruolo="dichiarazione_integrazione"
                    />
                  )}
                </>
              }
            />
          </>
        )}
      </div>

      {isAdmin && inBozza && (
        <p className="mt-3 text-xs text-slate-400">
          Il pacchetto lo compone il gruppo che realizza il video: è il loro
          deposito. Quando lo segnalano come completato, lo rivedi qui e decidi
          tu: sigillarlo o rimandarlo in composizione.
        </p>
      )}

      {/* ------------------------------------------------------ sigillo */}
      <div className="mt-6 border-t border-slate-100 pt-5">
        {inBozza ? (
          <>
            {componibile && (
              <>
                <label className="mb-3 flex items-start gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={testiConfermati}
                    onChange={(e) => setTestiConfermati(e.target.checked)}
                    className="mt-0.5"
                  />
                  Confermo che i testi inseriti (titolo, descrizione, script) sono la
                  versione definitiva, non una bozza.
                </label>
                <button
                  disabled={!completo || !testiConfermati || pending}
                  onClick={() =>
                    start(async () => {
                      setErrore(null);
                      setMessaggio(null);
                      const id = await assicuraPacchetto();
                      if (!id) return;

                      // La segnalazione legge dal database: salviamo i testi prima.
                      const salva = await salvaPacchetto(taskId, {
                        descrizione,
                        script,
                        titolo_youtube: titoloYoutube,
                      });
                      if (!salva.ok) return setErrore(salva.errore);

                      const esito = await segnalaCompletato(taskId, id);
                      if (!esito.ok) return setErrore(esito.errore);

                      setMessaggio(
                        "Pacchetto segnalato come completato: ora è in attesa della revisione.",
                      );
                      router.refresh();
                    })
                  }
                  className="tt-btn bg-tt-ink px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-40"
                >
                  {pending ? "Attendere…" : "Segnala completato"}
                </button>
              </>
            )}
            {!completo && (
              <p className="mt-2 text-xs text-slate-400">
                Mancano ancora:{" "}
                {[
                  !video && "video",
                  !copertina && "copertina",
                  !descrizione.trim() && "descrizione",
                  !script.trim() && "script",
                  !titoloYoutube.trim() && "titolo YouTube",
                  coinvolgeTerzi && !(liberatoria && liberatoriaOtp) && "liberatoria (firma OTP)",
                  haRichiesteAperte && "richieste di modifica da risolvere",
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Quando segnali il completamento il pacchetto passa alla revisione:
              non sarà più modificabile finché chi ha accesso globale non lo
              sigilla o lo rimanda in composizione.
            </p>
          </>
        ) : stato === "pronto" ? (
          isAdmin ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">
                Il gruppo ha segnalato il pacchetto come completato. Rivedi il
                materiale qui sopra: se è a posto sigilla — dopo il sigillo
                avrai un ultimo controllo sul verbale prima di confermare
                l&apos;invio della PEC — altrimenti rimandalo in composizione.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  disabled={!completo || pending}
                  onClick={() =>
                    start(async () => {
                      setErrore(null);
                      setMessaggio(null);
                      const esito = await sigillaPacchetto(taskId, pacchetto!.id);
                      if (!esito.ok) return setErrore(esito.errore);
                      setMessaggio(
                        "Pacchetto sigillato: controlla il verbale qui sotto, poi conferma per spedire la PEC.",
                      );
                      router.refresh();
                    })
                  }
                  className="tt-btn bg-tt-ink px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-40"
                >
                  {pending ? "Attendere…" : "Sigilla il pacchetto"}
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      setErrore(null);
                      setMessaggio(null);
                      const esito = await rimandaInComposizione(
                        taskId,
                        pacchetto!.id,
                      );
                      if (!esito.ok) return setErrore(esito.errore);
                      setMessaggio(
                        "Il pacchetto è tornato in composizione: il gruppo può modificarlo.",
                      );
                      router.refresh();
                    })
                  }
                  className="tt-btn border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
                >
                  Rimanda in composizione
                </button>
              </div>
              {!completo && (
                <p className="text-xs text-slate-400">
                  Mancano ancora:{" "}
                  {[
                    !video && "video",
                    !copertina && "copertina",
                    !descrizione.trim() && "descrizione",
                    !script.trim() && "script",
                    !titoloYoutube.trim() && "titolo YouTube",
                    coinvolgeTerzi && !(liberatoria && liberatoriaOtp) && "liberatoria (firma OTP)",
                    coinvolgeTerzi && !dichiarazione && "video di dichiarazione (da caricare in 'Video completo')",
                    haRichiesteAperte && "richieste di modifica da risolvere",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  .
                </p>
              )}
              <p className="text-xs text-slate-400">
                Il sigillo chiude la composizione per sempre: da lì in poi il
                pacchetto è immutabile e il verbale parte via PEC.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Il pacchetto è in attesa della revisione di chi ha accesso
              globale.
            </p>
          )
        ) : (
          <DettaglioSigillo
            taskId={taskId}
            pacchetto={pacchetto!}
            isAdmin={isAdmin}
            pending={pending}
            start={start}
            setErrore={setErrore}
            setMessaggio={setMessaggio}
            esportazione={esportazione}
          />
        )}
      </div>

      {messaggio && <p className="mt-3 text-sm text-emerald-700">{messaggio}</p>}
      {errore && <p className="mt-3 text-sm text-red-600">{errore}</p>}
    </section>
  );
}

function DettaglioSigillo({
  taskId,
  pacchetto,
  isAdmin,
  pending,
  start,
  setErrore,
  setMessaggio,
  esportazione,
}: {
  taskId: string;
  pacchetto: PacchettoVideoRow;
  isAdmin: boolean;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  setErrore: (s: string | null) => void;
  setMessaggio: (s: string | null) => void;
  esportazione: EsportazioneDriveRow | null;
}) {
  const [motivo, setMotivo] = useState("");
  const daSpedire = pacchetto.stato === "sigillato" || pacchetto.stato === "pec_errore";
  const inAttesaPrimoInvio = pacchetto.stato === "sigillato";

  return (
    <div className="space-y-3 text-sm">
      {inAttesaPrimoInvio && isAdmin && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Sigillato — la PEC non è ancora partita
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Controlla il verbale qui sotto: una volta confermato, &quot;Conferma
            e spedisci la PEC&quot; invia davvero il messaggio certificato,
            senza possibilità di annullarlo.
          </p>
        </div>
      )}
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">Sigillato il</dt>
          <dd>
            {pacchetto.sigillato_at
              ? new Date(pacchetto.sigillato_at).toLocaleString("it-IT")
              : "—"}
          </dd>
        </div>
        {pacchetto.pec_inviata_at && (
          <>
            <div>
              <dt className="text-xs text-slate-400">PEC inviata</dt>
              <dd>{new Date(pacchetto.pec_inviata_at).toLocaleString("it-IT")}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Message-ID</dt>
              <dd className="font-mono text-xs break-all">{pacchetto.pec_message_id}</dd>
            </div>
          </>
        )}
      </dl>

      <EsportazioneDrive pacchettoId={pacchetto.id} riga={esportazione} />

      {pacchetto.pec_ricevuta_note && (
        <p className="text-xs text-amber-700">{pacchetto.pec_ricevuta_note}</p>
      )}
      {pacchetto.pec_errore && (
        <p className="text-xs text-red-600">{pacchetto.pec_errore}</p>
      )}
      {pacchetto.annullato_motivo && (
        <p className="text-xs text-slate-500">
          Annullato: {pacchetto.annullato_motivo}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/task/${taskId}/verbale/${pacchetto.id}`}
          className="tt-btn border border-slate-300 px-3 py-1.5 text-xs"
        >
          Apri il verbale
        </Link>

        {daSpedire && isAdmin && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setErrore(null);
                setMessaggio(null);
                const esito = await inviaPecPacchetto(taskId, pacchetto.id);
                if (!esito.ok) setErrore(esito.errore);
                else
                  setMessaggio(
                    `PEC spedita (${esito.dati.messageId}). Allegati: ${esito.dati.allegati.join(", ")}.` +
                      (esito.dati.esclusi.length
                        ? ` Non allegati per dimensione: ${esito.dati.esclusi.join("; ")} — certificati tramite impronta.`
                        : "") +
                      ` La copia su Drive parte in automatico: l'esito compare nel badge qui sotto.`,
                  );
              })
            }
            className="tt-btn bg-tt-blue px-4 py-2 text-xs text-white hover:brightness-95 disabled:opacity-50"
          >
            {pacchetto.stato === "pec_errore" ? "Ritenta la PEC" : "Conferma e spedisci la PEC"}
          </button>
        )}

        {isAdmin && pacchetto.stato !== "annullato" && (
          <div className="flex items-center gap-2">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="motivo dell'annullamento"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-tt-blue/50 focus:border-tt-blue"
            />
            <button
              disabled={pending || !motivo.trim()}
              onClick={() =>
                start(async () => {
                  const esito = await annullaPacchetto(taskId, pacchetto.id, motivo);
                  if (!esito.ok) setErrore(esito.errore);
                  else setMessaggio("Pacchetto annullato: resta comunque a registro.");
                })
              }
              className="tt-btn border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-40"
            >
              Annulla pacchetto
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Slot({
  id,
  titolo,
  elemento,
  azione,
  onRimuovi,
  onDropFile,
  taskId,
  archiviabile,
  confermato,
  footer,
  isAdmin,
}: {
  id?: string;
  titolo: string;
  elemento?: ElementoCaricato;
  azione: React.ReactNode;
  onRimuovi?: () => void;
  onDropFile?: (file: File) => void;
  taskId: string;
  archiviabile: boolean;
  /** true quando il testo è confermato come versione definitiva o il pacchetto non è più in bozza. */
  confermato: boolean;
  /** Nota e azioni proprie dello slot (es. "Segnala errore"): dentro la riga, non fuori. */
  footer?: React.ReactNode;
  /** Mostra "Scarica" quando l'elemento porta bucket/storage_path (solo per l'admin, vedi pacchetto_elementi_meta). */
  isAdmin: boolean;
}) {
  const [conferma, setConferma] = useState(false);
  const [confermaArchivia, setConfermaArchivia] = useState(false);
  const [erroreArchivia, setErroreArchivia] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [scaricoInCorso, setScaricoInCorso] = useState(false);
  const [erroreScarica, setErroreScarica] = useState<string | null>(null);
  const router = useRouter();

  async function archivia() {
    setErroreArchivia(null);
    const res = await archiviaFileFinale(taskId, elemento!.version_id);
    if (!res.ok) {
      setErroreArchivia(res.errore);
      setConfermaArchivia(false);
      return;
    }
    router.refresh();
  }

  async function scarica() {
    if (!elemento?.bucket || !elemento.storage_path) return;
    setScaricoInCorso(true);
    setErroreScarica(null);
    const esito = await urlFirmato(elemento.bucket, elemento.storage_path);
    setScaricoInCorso(false);
    if (!esito.ok) {
      setErroreScarica(esito.errore);
      return;
    }
    window.location.href = esito.dati.url;
  }

  return (
    <div
      id={id}
      onDragOver={
        onDropFile
          ? (e) => {
              e.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={onDropFile ? () => setDragOver(false) : undefined}
      onDrop={
        onDropFile
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onDropFile(f);
            }
          : undefined
      }
      className={`px-5 py-4 transition-colors ${
        dragOver ? "bg-tt-blue/5 ring-2 ring-inset ring-tt-blue" : elemento ? "bg-tt-blue-50/60" : ""
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <h3 className="text-sm font-medium sm:flex-1">{titolo}</h3>
        {azione}
      </div>
      {elemento ? (
        <div className="mt-2">
          <p className="truncate text-sm" title={elemento.file_name}>
            {elemento.file_name}
          </p>
          <p className="text-xs text-slate-400">
            {formatBytes(elemento.size_bytes)} ·{" "}
            {new Date(elemento.uploaded_at).toLocaleString("it-IT")}
          </p>

          {isAdmin && elemento.bucket && elemento.storage_path && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs">
              <button
                onClick={scarica}
                disabled={scaricoInCorso}
                className="flex items-center gap-1 font-medium text-tt-blue hover:underline disabled:opacity-50"
              >
                {scaricoInCorso ? <IconaSpinner /> : <IconaScarica />}
                Scarica
              </button>
              {erroreScarica && <span className="text-red-600">{erroreScarica}</span>}
            </p>
          )}

          {onRimuovi &&
            (conferma ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Rimuovere?</span>
                <button
                  onClick={() => {
                    setConferma(false);
                    onRimuovi();
                  }}
                  className="font-medium text-red-600 hover:underline"
                >
                  Sì
                </button>
                <button
                  onClick={() => setConferma(false)}
                  className="text-slate-500 hover:underline"
                >
                  No
                </button>
              </p>
            ) : (
              <button
                onClick={() => setConferma(true)}
                className="mt-1.5 text-xs text-slate-400 hover:text-red-600 hover:underline"
              >
                Rimuovi
              </button>
            ))}

          {elemento.archiviato_esterno ? (
            <p className="mt-2 text-xs text-emerald-600 font-medium">
              Archiviato esternamente ✓
            </p>
          ) : archiviabile ? (
            <div className="mt-2">
              {confermaArchivia ? (
                <div>
                  {erroreArchivia && (
                    <p className="text-xs text-red-600 mb-1">{erroreArchivia}</p>
                  )}
                  <p className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500">Archiviare il file?</span>
                    <button onClick={archivia} className="font-medium text-emerald-600 hover:underline">
                      Sì
                    </button>
                    <button onClick={() => { setConfermaArchivia(false); setErroreArchivia(null); }} className="text-slate-500 hover:underline">
                      No
                    </button>
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setConfermaArchivia(true)}
                  className="text-xs text-slate-400 hover:text-emerald-600 hover:underline"
                >
                  Archivia
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : azione ? null : (
        <p className="mt-2 text-xs text-slate-400">Nessun file.</p>
      )}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

function Testo({
  id,
  titolo,
  nota,
  valore,
  onChange,
  modificabile,
  righe,
  placeholder,
  onImporta,
  confermato,
}: {
  id?: string;
  titolo: string;
  nota?: string;
  valore: string;
  onChange: (s: string) => void;
  modificabile: boolean;
  righe: number;
  placeholder?: string;
  onImporta?: () => void;
  /** true quando il pacchetto non è più in bozza: il gruppo ha già confermato che questo testo è la versione definitiva, non una bozza. */
  confermato: boolean;
}) {
  const [importando, setImportando] = useState(false);

  async function handleImporta() {
    if (!onImporta) return;
    setImportando(true);
    await onImporta();
    setImportando(false);
  }

  return (
    <div
      id={id}
      className={`px-5 py-4 ${
        !valore.trim() ? "" : confermato ? "bg-tt-blue-50/60" : "bg-amber-50"
      }`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{titolo}</h3>
        {modificabile && onImporta && (
          <button
            onClick={handleImporta}
            disabled={importando}
            className="tt-btn ml-auto shrink-0 bg-tt-blue px-2.5 py-1 text-[11px] text-white hover:brightness-95 disabled:opacity-50"
          >
            {importando ? "…" : "⬇ Importa dal Doc"}
          </button>
        )}
      </div>
      {nota && <p className="mt-0.5 text-xs text-slate-400">{nota}</p>}
      {modificabile ? (
        <textarea
          rows={righe}
          value={valore}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        />
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
          {valore || <span className="text-slate-400">— vuoto —</span>}
        </p>
      )}
    </div>
  );
}
