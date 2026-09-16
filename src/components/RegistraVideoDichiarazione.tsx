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

type Fase = "idle" | "avvio" | "registrazione" | "revisione" | "elaborazione" | "caricamento";

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

/**
 * Rimuove la frammentazione da un mp4 registrato dal browser (riscrive solo
 * il contenitore con -c copy: nessuna ricompressione, stessa qualità),
 * così è apribile con QuickTime/Safari e non solo con Chrome/VLC.
 *
 * @ffmpeg/ffmpeg è importato dinamicamente (non nel bundle iniziale: pesa
 * ~30 MB, va scaricato solo se e quando serve davvero, cioè qui). I file
 * del motore sono su /ffmpeg (stesso dominio, non una CDN esterna — vedi
 * worker-src nella CSP di next.config.ts).
 */
async function remuxMp4(blob: Blob): Promise<Blob> {
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import("@ffmpeg/ffmpeg"),
    import("@ffmpeg/util"),
  ]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL("/ffmpeg/ffmpeg-core.js", "text/javascript"),
    wasmURL: await toBlobURL("/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
  });
  try {
    await ffmpeg.writeFile("input.mp4", new Uint8Array(await blob.arrayBuffer()));
    await ffmpeg.exec(["-i", "input.mp4", "-c", "copy", "-movflags", "+faststart", "output.mp4"]);
    const output = await ffmpeg.readFile("output.mp4");
    const bytes = output as Uint8Array;
    return new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
  } finally {
    ffmpeg.terminate();
  }
}

export default function RegistraVideoDichiarazione({
  onFileReady,
}: {
  onFileReady: (file: File) => void;
}) {
  const [fase, setFase] = useState<Fase>("idle");
  const [errore, setErrore] = useState<string | null>(null);
  const [secondi, setSecondi] = useState(0);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  // URL blob del video da rivedere: stato React (non un ref con assegnazione
  // imperativa di .src dopo il render) apposta — quel pattern, usato prima,
  // lasciava una finestra in cui il <video> di revisione poteva restare
  // senza sorgente su Safari iOS, riscontrato con un video vero registrato
  // e mai riprodotto sullo stesso telefono che l'aveva appena girato.
  const [blobUrl, setBlobUrlState] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  // Specchio di blobUrl in un ref: serve solo alla pulizia allo smontaggio
  // (un effect con dipendenze vuote non vedrebbe mai il valore più recente
  // dello stato).
  const blobUrlRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);

  function impostaBlobUrl(url: string | null) {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = url;
    setBlobUrlState(url);
  }

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
    // Scollega subito l'anteprima live dallo stream fermato: senza questo,
    // l'elemento continuerebbe a puntare a un MediaStream con i track già
    // stoppati (schermo nero) finché non viene smontato dal DOM.
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  function revocaBlob() {
    impostaBlobUrl(null);
    blobRef.current = null;
    chunksRef.current = [];
  }

  // Richiede la fotocamera indicata e la aggancia all'anteprima live.
  // Separata da avviaRecorder: serve anche per il solo cambio fotocamera,
  // senza toccare una registrazione già in corso quando non necessario.
  async function avviaStream(mode: "user" | "environment") {
    fermaStream();
    // facingMode come preferenza "ideale", non "exact": su un notebook con
    // una sola fotocamera (o senza posteriore) la richiesta non fallisce,
    // torna semplicemente l'unica disponibile.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode },
      audio: true,
    });
    streamRef.current = stream;
    if (previewRef.current) {
      previewRef.current.srcObject = stream;
      void previewRef.current.play().catch(() => {});
    }
    return stream;
  }

  function avviaRecorder(stream: MediaStream) {
    // mp4 preferito quando disponibile: il Coordinatore rivede questi video
    // su Mac (Safari/QuickTime), che non decodificano affatto WebM. Il primo
    // tentativo chiede ESPLICITAMENTE h264+aac (avc1/mp4a): un "video/mp4"
    // generico lascia al browser la scelta del codec, e Safari 18.4+ può
    // scegliere di default HEVC o audio Opus dentro l'mp4 — entrambi non
    // decodificati in modo affidabile da QuickTime/Safari sullo stesso Mac
    // che dovrebbe poi rivederli (riscontrato con un video mp4 vero, non
    // riproducibile). avc1/mp4a è la combinazione più compatibile che
    // esista, supportata da Safari da anni. Se il dispositivo di chi
    // registra non sa produrre nessuna variante mp4, isTypeSupported
    // restituisce false e si scende sul webm come prima — nessuna
    // regressione per chi non lo supporta.
    const supportato = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((m) => window.MediaRecorder.isTypeSupported(m));
    const recorder = new window.MediaRecorder(stream, supportato ? { mimeType: supportato } : undefined);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" });
      fermaStream();
      fermaTimer();
      setSecondi(0);
      // Registrazione vuota (es. fermata troppo in fretta dopo un cambio
      // fotocamera, che riparte sempre da un MediaRecorder nuovo): niente
      // fotogrammi catturati. Invece di portare su un player rotto (schermo
      // nero, 0:00/0:00), si torna a "idle" con un errore chiaro.
      if (blob.size === 0) {
        chunksRef.current = [];
        setFase("idle");
        setErrore("Registrazione troppo breve: non è stato catturato nulla. Riprova, aspettando qualche secondo prima di fermare (specialmente dopo aver cambiato fotocamera).");
        return;
      }
      blobRef.current = blob;
      // src passato direttamente nel JSX (vedi il ramo "revisione" sotto):
      // niente più assegnazione imperativa dopo il render, che su Safari
      // iOS poteva lasciare il <video> senza sorgente.
      impostaBlobUrl(URL.createObjectURL(blob));
      setFase("revisione");
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
      const stream = await avviaStream(facingMode);
      avviaRecorder(stream);
    } catch (e) {
      fermaStream();
      setFase("idle");
      setErrore(messaggioErroreCamera(e));
    }
  }

  // Cambia fotocamera frontale/posteriore. MediaRecorder resta legato allo
  // stream con cui è stato creato: non è possibile sostituire la sorgente
  // video di una registrazione in corso, quindi se si sta registrando si
  // riparte da zero con la nuova fotocamera (scartando quanto già ripreso,
  // dopo un avviso all'utente).
  async function cambiaFotocamera() {
    const stavaRegistrando = fase === "registrazione";
    const nuovoFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(nuovoFacing);
    setErrore(null);

    if (stavaRegistrando) {
      fermaTimer();
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        // Sganciati anche da ondataavailable: se il vecchio recorder consegna
        // l'ultimo chunk in ritardo (dopo che avviaRecorder ha già creato il
        // nuovo chunksRef), non deve finire mescolato nella nuova ripresa.
        r.onstop = null;
        r.ondataavailable = null;
        try {
          r.stop();
        } catch {
          /* noop */
        }
      }
      chunksRef.current = [];
    }

    try {
      const stream = await avviaStream(nuovoFacing);
      if (stavaRegistrando) avviaRecorder(stream);
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

  async function conferma() {
    const blob = blobRef.current;
    if (!blob) return;
    const estensione = blob.type.includes("mp4") ? "mp4" : "webm";
    const nome = `dichiarazione-${new Date().toISOString().replace(/[:.]/g, "-")}.${estensione}`;

    let blobDaCaricare = blob;
    // I registratori dei browser producono mp4 "frammentato" (a pezzi, per
    // lo streaming): valido, ma QuickTime/Safari su Mac spesso non lo
    // riproducono aprendolo come file — anche essendo la stessa piattaforma
    // che l'ha registrato. Il remux (solo riorganizzare il contenitore, non
    // ricomprimere: stessa qualità, stessi secondi) lo rende un mp4
    // "normale" apribile ovunque. Se fallisce per qualunque motivo (rete,
    // browser non supportato), si carica comunque il file originale — mai
    // bloccare la consegna della dichiarazione per un problema di comodità
    // nella revisione.
    if (estensione === "mp4") {
      setFase("elaborazione");
      try {
        blobDaCaricare = await remuxMp4(blob);
      } catch {
        blobDaCaricare = blob;
      }
    }

    const file = new File([blobDaCaricare], nome, { type: blobDaCaricare.type || blob.type || "video/webm" });
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
      // key distinta da quella del ramo "revisione" sotto: così React smonta
      // e rimonta il nodo <video> invece di riusarlo tra le due fasi — senza
      // questo, l'anteprima di revisione può restare agganciata allo stream
      // della fotocamera (già fermato) invece che al video registrato.
      <div key="camera-live" className="mt-2 w-full max-w-xs">
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
            disabled={fase === "avvio" || secondi < 1}
            title={secondi < 1 ? "Aspetta un secondo prima di fermare" : undefined}
            className="tt-btn bg-red-600 px-4 py-2 text-sm text-white hover:brightness-95 disabled:opacity-50"
          >
            Ferma e rivedi
          </button>
          <button
            onClick={cambiaFotocamera}
            disabled={fase === "avvio"}
            className="tt-btn border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Cambia fotocamera
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
      <div key="camera-revisione" className="mt-2 w-full max-w-xs">
        {/* key={blobUrl}: forza un nodo <video> del tutto nuovo per ogni
            registrazione, invece di riusare quello di un tentativo
            precedente e limitarsi a cambiarne il src — un pattern con cui
            Safari iOS può restare bloccato sul contenuto vecchio. */}
        <video
          key={blobUrl}
          controls
          playsInline
          src={blobUrl ?? undefined}
          className="h-40 w-full rounded-lg bg-slate-900 object-contain"
        />
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

  if (fase === "elaborazione") {
    return (
      <div className="mt-2 w-full max-w-xs text-center">
        <p className="text-xs text-slate-500">Preparazione del video…</p>
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

