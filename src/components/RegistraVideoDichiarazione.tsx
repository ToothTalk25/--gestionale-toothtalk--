"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Registrazione video direttamente dal browser (getUserMedia + MediaRecorder)
 * per gli slot 7/7b del Video completo: un'alternativa all'upload da file,
 * pensata perché il Collaboratore non debba accumulare copie del video di
 * dichiarazione nella galleria del telefono.
 *
 * Il flusso è volutamente in due tempi:
 *  1. il video resta sul dispositivo (blob in memoria, URL blob nel browser)
 *     e può essere rivisto prima di qualsiasi trasferimento;
 *  2. solo alla conferma esplicita il file entra nella catena di upload già
 *     esistente (onFileReady -> UploadDeliverable.handleFile -> registraVersione).
 *
 * Chi ha registrato ha già rivisto il video qui: dopo il caricamento non
 * serve più alcun accesso al file (la RLS lo rende leggibile solo al
 * Titolare). L'upload da file resta come riserva per i casi in cui la
 * registrazione in-app non sia disponibile (permessi negati, dispositivi
 * assenti, browser non supportato).
 */

type Fase = "idle" | "avvio" | "registrazione" | "revisione" | "caricamento";

/** Cap di durata: un video di dichiarazione è breve; oltre si ferma da solo. */
const DURATA_MAX_SECONDI = 10 * 60;

function formatoSecondi(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function messaggioErroreCamera(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError" || e.name === "SecurityError") {
      return "Permesso negato: per registrare serve il consenso a fotocamera e microfono. Puoi usare il caricamento file.";
    }
    if (e.name === "NotFoundError") {
      return "Nessuna fotocamera o microfono disponibili su questo dispositivo. Puoi usare il caricamento file.";
    }
    if (e.name === "NotReadableError") {
      return "Fotocamera o microfono già in uso da un'altra applicazione: chiudila e riprova.";
    }
    if (e.name === "OverconstrainedError") {
      return "Il dispositivo non soddisfa i requisiti richiesti. Prova con il caricamento file.";
    }
  }
  return "Registrazione non riuscita. Controlla i permessi del browser e riprova, oppure usa il caricamento file.";
}
export default function RegistraVideoDichiarazione({
  onFileReady,
}: {
  onFileReady: (file: File) => void;
}) {
  const [fase, setFase] = useState<Fase>("idle");
  const [errore, setErrore] = useState<string | null>(null);
  const [secondi, setSecondi] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const reviewRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);

  // Pulizia totale all'uscita: la fotocamera non deve restare accesa e gli
  // URL blob non devono restare in memoria se l'utente cambia pagina.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        r.onstop = null;
        try {
          r.stop();
        } catch {
          /* noop */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  function fermaTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function fermaStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function revocaBlob() {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    blobRef.current = null;
    chunksRef.current = [];
  }

  async function avvia() {
    setErrore(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === "undefined") {
      setErrore(
        "La registrazione in-app non è disponibile su questo browser: usa il pulsante 'Carica video di dichiarazione'.",
      );
      return;
    }
    setFase("avvio");
    try {
      // facingMode "user" (non "exact"): preferisce la fotocamera frontale,
      // così chi si registra da solo si vede — su un notebook con una sola
      // fotocamera il vincolo "ideale" non fa fallire la richiesta.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(() => {});
      }

      const supportato = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) =>
        window.MediaRecorder.isTypeSupported(m),
      );
      const recorder = new window.MediaRecorder(stream, supportato ? { mimeType: supportato } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
        blobRef.current = blob;
        fermaStream();
        fermaTimer();
        setSecondi(0);
        setFase("revisione");
        // L'anteprima va agganciata al <video> di revisione dopo il render.
        requestAnimationFrame(() => {
          if (reviewRef.current && blobUrlRef.current === null) {
            blobUrlRef.current = URL.createObjectURL(blob);
            reviewRef.current.src = blobUrlRef.current;
          }
        });
      };

      recorder.start(1000);
      setFase("registrazione");
      setSecondi(0);
      timerRef.current = window.setInterval(() => {
        setSecondi((s) => {
          const n = s + 1;
          if (n >= DURATA_MAX_SECONDI) ferma();
          return n;
        });
      }, 1000);
    } catch (e) {
      fermaStream();
      setFase("idle");
      setErrore(messaggioErroreCamera(e));
    }
  }

  function ferma() {
    fermaTimer();
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
  }

  function annullaRegistrazione() {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      r.onstop = null;
      try {
        r.stop();
      } catch {
        /* noop */
      }
    }
    fermaStream();
    fermaTimer();
    chunksRef.current = [];
    blobRef.current = null;
    setSecondi(0);
    setFase("idle");
  }

  function conferma() {
    const blob = blobRef.current;
    if (!blob) return;
    const estensione = blob.type.includes("mp4") ? "mp4" : "webm";
    const nome = `dichiarazione-${new Date().toISOString().replace(/[:.]/g, "-")}.${estensione}`;
    const file = new File([blob], nome, { type: blob.type || "video/webm" });
    setFase("caricamento");
    revocaBlob();
    onFileReady(file);
  }

  function riprova() {
    revocaBlob();
    setErrore(null);
    setFase("idle");
    void avvia();
  }

  if (fase === "avvio" || fase === "registrazione") {
    return (
      <div className="mt-2 w-full max-w-xs">
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          className="h-40 w-full rounded-lg bg-slate-900 object-cover"
        />
        <p className="mt-1 text-center text-xs text-slate-500">
          {fase === "avvio" ? "Accesso a fotocamera e microfono…" : `Registrazione… ${formatoSecondi(secondi)}`}
        </p>
        <div className="mt-1.5 flex justify-center gap-2">
          <button
            onClick={ferma}
            disabled={fase === "avvio"}
            className="tt-btn bg-red-600 px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
          >
            Ferma e rivedi
          </button>
          <button onClick={annullaRegistrazione} className="tt-btn border border-slate-300 px-4 py-2 text-sm">
            Annulla
          </button>
        </div>
      </div>
    );
  }

  if (fase === "revisione") {
    return (
      <div className="mt-2 w-full max-w-xs">
        <video ref={reviewRef} controls playsInline className="h-40 w-full rounded-lg bg-slate-900 object-contain" />
        <p className="mt-1 text-center text-xs text-slate-500">
          Rivedi il video: è solo su questo dispositivo, non ancora caricato.
        </p>
        <div className="mt-1.5 flex justify-center gap-2">
          <button onClick={conferma} className="tt-btn bg-tt-blue px-4 py-2 text-sm text-white hover:brightness-95">
            Conferma e carica
          </button>
          <button onClick={riprova} className="tt-btn border border-slate-300 px-4 py-2 text-sm">
            Riprova
          </button>
        </div>
      </div>
    );
  }

  if (fase === "caricamento") {
    return (
      <div className="mt-2 w-full max-w-xs text-center">
        <p className="text-xs text-slate-500">Caricamento in corso…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={avvia}
        className="tt-btn border border-tt-blue px-4 py-2 text-sm text-tt-blue hover:bg-tt-blue/5"
      >
        Registra video in-app
      </button>
      {errore && <p className="max-w-xs text-center text-xs text-red-600">{errore}</p>}
    </div>
  );
}

