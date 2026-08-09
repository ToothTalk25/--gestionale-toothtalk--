"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UploadDeliverable from "@/components/UploadDeliverable";
import { formatBytes } from "@/lib/hash";
import { impostaCoinvolgeTerzi } from "@/app/actions";
import {
  annullaPacchetto,
  collegaElemento,
  inviaPecPacchetto,
  rimandaInComposizione,
  rimuoviElementoPacchetto,
  salvaPacchetto,
  segnalaCompletato,
  sigillaPacchetto,
} from "@/app/actions-pacchetto";
import {
  PACCHETTO_LABEL,
  type PacchettoStato,
  type PacchettoVideoRow,
  type RuoloElemento,
} from "@/lib/types";

export type ElementoCaricato = {
  ruolo: RuoloElemento;
  file_name: string;
  sha256: string;
  size_bytes: number | null;
  uploaded_at: string;
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
}: {
  taskId: string;
  pacchetto: PacchettoVideoRow | null;
  elementi: ElementoCaricato[];
  isAdmin: boolean;
  locked: boolean;
  coinvolgeTerzi: boolean;
}) {
  const router = useRouter();
  const [descrizione, setDescrizione] = useState(pacchetto?.descrizione ?? "");
  const [script, setScript] = useState(pacchetto?.script ?? "");
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const stato = pacchetto?.stato ?? "bozza";
  const inBozza = stato === "bozza";
  // Il pacchetto lo compone il gruppo, non chi ha accesso globale: è il loro deposito, e
  // la RLS rifiuterebbe comunque una consegna "originale" fatta dall'Admin.
  const componibile = inBozza && !locked && !isAdmin;

  const video = elementi.find((e) => e.ruolo === "video");
  const copertina = elementi.find((e) => e.ruolo === "copertina");
  const liberatoria = elementi.find((e) => e.ruolo === "liberatoria");
  const completo =
    !!video &&
    !!copertina &&
    descrizione.trim() !== "" &&
    script.trim() !== "" &&
    (!coinvolgeTerzi || !!liberatoria);

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
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-medium">Video completo</h2>
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
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORI[stato]}`}
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
            Es. un&apos;intervista. Se selezionato, la liberatoria diventa un
            elemento obbligatorio qui sotto e blocca il sigillo finché non
            viene caricata.
          </span>
        </span>
      </label>

      {/* ---------------------------------------------------- elementi */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Slot
          titolo="1 · Video montato"
          elemento={video}
          onRimuovi={componibile && video ? () => rimuovi("video") : undefined}
          azione={
            componibile ? (
              <UploadDeliverable
                taskId={taskId}
                kind="finale_video"
                archivio="finale"
                isAdmin={false}
                locked={locked}
                etichetta={video ? "Sostituisci" : "Carica video"}
                accept="video/*"
                onCaricato={(v) => dopoUpload("video", v)}
              />
            ) : null
          }
        />
        <Slot
          titolo="2 · Copertina"
          elemento={copertina}
          onRimuovi={
            componibile && copertina ? () => rimuovi("copertina") : undefined
          }
          azione={
            componibile ? (
              <UploadDeliverable
                taskId={taskId}
                kind="finale_copertina"
                archivio="finale"
                isAdmin={false}
                locked={locked}
                etichetta={copertina ? "Sostituisci" : "Carica copertina"}
                accept="image/*"
                onCaricato={(v) => dopoUpload("copertina", v)}
              />
            ) : null
          }
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Testo
          titolo="3 · Descrizione da pubblicare"
          valore={descrizione}
          onChange={setDescrizione}
          modificabile={componibile}
          righe={5}
          placeholder="La caption esatta che accompagnerà il video…"
        />
        <Testo
          titolo="4 · Script usato"
          nota="dev'essere ciò che si dice davvero nel video"
          valore={script}
          onChange={setScript}
          modificabile={componibile}
          righe={5}
          placeholder="Incolla qui il testo effettivamente pronunciato nel video…"
        />
      </div>

      {coinvolgeTerzi && (
        <div className="mt-4">
          <Slot
            titolo="5 · Liberatoria privacy/immagine"
            elemento={liberatoria}
            onRimuovi={
              componibile && liberatoria ? () => rimuovi("liberatoria") : undefined
            }
            azione={
              componibile ? (
                <UploadDeliverable
                  taskId={taskId}
                  kind="finale_liberatoria"
                  archivio="finale"
                  isAdmin={false}
                  locked={locked}
                  etichetta={liberatoria ? "Sostituisci" : "Carica liberatoria"}
                  accept="application/pdf,image/*"
                  onCaricato={(v) => dopoUpload("liberatoria", v)}
                />
              ) : null
            }
          />
        </div>
      )}

      {isAdmin && inBozza && (
        <p className="mt-3 text-xs text-slate-400">
          Il pacchetto lo compone il gruppo che realizza il video: è il loro
          deposito. Quando lo segnalano come completato, lo rivedi qui e decidi
          tu: sigillarlo o rimandarlo in composizione.
        </p>
      )}

      {componibile && (
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErrore(null);
              setMessaggio(null);
              const esito = await salvaPacchetto(taskId, { descrizione, script });
              if (!esito.ok) setErrore(esito.errore);
              else {
                setMessaggio("Testi salvati.");
                router.refresh();
              }
            })
          }
          className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          Salva descrizione e script
        </button>
      )}

      {/* ------------------------------------------------------ sigillo */}
      <div className="mt-6 border-t border-slate-100 pt-5">
        {inBozza ? (
          <>
            {componibile && (
              <button
                disabled={!completo || pending}
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
                className="rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {pending ? "Attendere…" : "Segnala completato"}
              </button>
            )}
            {!completo && (
              <p className="mt-2 text-xs text-slate-400">
                Mancano ancora:{" "}
                {[
                  !video && "video",
                  !copertina && "copertina",
                  !descrizione.trim() && "descrizione",
                  !script.trim() && "script",
                  coinvolgeTerzi && !liberatoria && "liberatoria",
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
                materiale qui sopra: se è a posto sigilla, altrimenti rimandalo
                in composizione.
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
                        `Pacchetto sigillato. Impronta manifesto ${esito.dati.manifestHash.slice(0, 16)}…`,
                      );
                      router.refresh();
                    })
                  }
                  className="rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
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
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
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
                    coinvolgeTerzi && !liberatoria && "liberatoria",
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
}: {
  taskId: string;
  pacchetto: PacchettoVideoRow;
  isAdmin: boolean;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  setErrore: (s: string | null) => void;
  setMessaggio: (s: string | null) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const daSpedire = pacchetto.stato === "sigillato" || pacchetto.stato === "pec_errore";

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-400">Sigillato il</dt>
          <dd>
            {pacchetto.sigillato_at
              ? new Date(pacchetto.sigillato_at).toLocaleString("it-IT")
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-400">Impronta del manifesto</dt>
          <dd className="font-mono text-xs break-all">{pacchetto.manifest_hash}</dd>
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
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
                        : ""),
                  );
              })
            }
            className="rounded-lg bg-tt-blue px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {pacchetto.stato === "pec_errore" ? "Ritenta la PEC" : "Invia il verbale via PEC"}
          </button>
        )}

        {isAdmin && pacchetto.stato !== "annullato" && (
          <div className="flex items-center gap-2">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="motivo dell'annullamento"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
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
              className="rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-40"
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
  titolo,
  elemento,
  azione,
  onRimuovi,
}: {
  titolo: string;
  elemento?: ElementoCaricato;
  azione: React.ReactNode;
  onRimuovi?: () => void;
}) {
  const [conferma, setConferma] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-sm font-medium">{titolo}</h3>
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
          <p className="mt-1 font-mono text-[10px] break-all text-slate-400">
            {elemento.sha256}
          </p>

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
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">Nessun file.</p>
      )}
    </div>
  );
}

function Testo({
  titolo,
  nota,
  valore,
  onChange,
  modificabile,
  righe,
  placeholder,
}: {
  titolo: string;
  nota?: string;
  valore: string;
  onChange: (s: string) => void;
  modificabile: boolean;
  righe: number;
  placeholder?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <h3 className="text-sm font-medium">
        {titolo}
        {nota && (
          <span className="ml-2 font-normal text-xs text-slate-400">{nota}</span>
        )}
      </h3>
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
