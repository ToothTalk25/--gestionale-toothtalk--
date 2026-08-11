"use client";

import { useState, useTransition, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { firmaLiberatoriaOnline } from "@/app/actions-liberatoria";

export default function CaricaLiberatoriaPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-sm px-4 py-20 text-center"><p className="text-sm text-slate-600">Caricamento…</p></div>}>
      <CaricaLiberatoriaForm />
    </Suspense>
  );
}

function CaricaLiberatoriaForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [nome, setNome] = useState("");
  const [consenso, setConsenso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [firmato, setFirmato] = useState(false);

  if (!token) return (<div className="mx-auto max-w-sm px-4 py-20 text-center"><p className="text-sm text-slate-600">Link non valido.</p></div>);
  if (ok) return (<div className="mx-auto max-w-sm px-4 py-20 text-center"><p className="text-lg font-medium text-emerald-700">Liberatoria firmata ✓</p><p className="mt-2 text-sm text-slate-600">Grazie. Il documento è stato ricevuto. Puoi chiudere questa pagina.</p></div>);

  let disegnando = false;
  function iniziaFirma(e: React.MouseEvent | React.TouchEvent) {
    disegnando = true;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.beginPath();
    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e ? e.touches[0]?.clientX : (e as React.MouseEvent).clientX) ?? 0;
    const y = ("touches" in e ? e.touches[0]?.clientY : (e as React.MouseEvent).clientY) ?? 0;
    ctx.moveTo(x - rect.left, y - rect.top);
    setFirmato(true);
  }
  function disegna(e: React.MouseEvent | React.TouchEvent) {
    if (!disegnando) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ("touches" in e ? e.touches[0]?.clientX : (e as React.MouseEvent).clientX) ?? 0;
    const y = ("touches" in e ? e.touches[0]?.clientY : (e as React.MouseEvent).clientY) ?? 0;
    ctx.lineWidth = 2; ctx.strokeStyle = "#1e3a5f"; ctx.lineCap = "round";
    ctx.lineTo(x - rect.left, y - rect.top); ctx.stroke();
  }
  function fineFirma() { disegnando = false; }
  function cancellaFirma() {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setFirmato(false);
  }

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) { setErrore("Inserisci nome e cognome."); return; }
    if (!consenso) { setErrore("Devi acconsentire al trattamento."); return; }
    if (!firmato) { setErrore("Disegna la tua firma nel riquadro."); return; }
    const firmaImg = canvasRef.current?.toDataURL("image/png") ?? "";
    start(async () => { setErrore(null); const esito = await firmaLiberatoriaOnline(token!, nome.trim(), firmaImg); if (!esito.ok) setErrore(esito.errore); else setOk(true); });
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="h-8 w-auto" />
        <h1 className="mt-6 text-lg font-semibold text-slate-800">Liberatoria privacy / immagine</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Con la presente il/la sottoscritto/a autorizza il progetto <strong>ToothTalk</strong> —
          progetto di divulgazione odontoiatrica — a riprendere e pubblicare la propria immagine e
          voce nel video per il quale è stato/a intervistato/a, esclusivamente per le finalità del
          progetto e in conformità all'informativa privacy.
        </p>
        <form onSubmit={invia} className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700">Nome e cognome</label>
            <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Il tuo nome e cognome" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consenso} onChange={(e) => setConsenso(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span className="text-slate-600">Acconsento al trattamento della mia immagine e voce per le finalità del progetto ToothTalk.</span>
          </label>
          <div>
            <label className="block text-sm font-medium text-slate-700">Firma</label>
            <p className="mb-2 text-xs text-slate-400">Disegna la firma col dito (o col mouse) nel riquadro.</p>
            <canvas ref={canvasRef} width={400} height={120}
              onMouseDown={iniziaFirma} onMouseMove={disegna} onMouseUp={fineFirma} onMouseLeave={fineFirma}
              onTouchStart={iniziaFirma} onTouchMove={disegna} onTouchEnd={fineFirma}
              className="w-full rounded-lg border border-slate-300 bg-slate-50" />
            {firmato && (<button type="button" onClick={cancellaFirma} className="mt-1 text-xs text-slate-400 underline hover:text-slate-600">Cancella firma</button>)}
          </div>
          {errore && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errore}</p>}
          <button type="submit" disabled={pending} className="w-full rounded-lg bg-tt-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Invio…" : "Firma e invia"}
          </button>
        </form>
      </div>
    </div>
  );
}
