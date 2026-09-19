"use client";

import { useEffect, useRef, useState } from "react";
import {
  inviaDomanda,
  elencaMieDomande,
  richiediCoordinatore,
  type RigaDomandaSupporto,
} from "@/app/actions-supporto";

const CHIAVE_POSIZIONE = "tt_widget_domande_pos";
const CHIAVE_VISTO = "tt_widget_domande_visto_at";

/** Riga ancora senza risposta: serve per il polling e per il pallino "nuovo". */
function inAttesa(d: RigaDomandaSupporto): boolean {
  return !d.risposta;
}

/**
 * Bottone flottante "?" (spostabile) presente su ogni pagina dell'app:
 * apre una chat di supporto. La domanda viene ordinata da un sistema
 * automatico (IA) e smistata: quelle sul funzionamento dell'app vanno al
 * Collaboratore Tecnico, tutte le altre al Coordinatore. A rispondere è sempre
 * una persona — nessun testo scritto dall'IA arriva qui — e chi scrive lo legge
 * sotto il campo, con il modo di chiamare direttamente il Coordinatore se non
 * vuole aspettare.
 */
export default function WidgetDomande() {
  const [aperto, setAperto] = useState(false);
  // null = posizione di default (CSS, basso a destra) — mai calcolata da
  // window.innerWidth/Height al mount: in alcuni contesti (prima misurazione,
  // SSR/idratazione) quei valori possono essere 0 e produrre coordinate
  // negative, portando il bottone fuori schermo. Coordinate reali (px)
  // arrivano solo da un trascinamento vero, dove i valori sono sempre
  // corretti perché letti durante un gesto utente in corso.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [domande, setDomande] = useState<RigaDomandaSupporto[]>([]);
  const [testo, setTesto] = useState("");
  const [invio, setInvio] = useState(false);
  const [nonVisti, setNonVisti] = useState(false);
  const trascinamento = useRef<{ startX: number; startY: number; dx: number; dy: number; mosso: boolean } | null>(
    null,
  );
  const corpoRef = useRef<HTMLDivElement>(null);

  // Ripristina l'eventuale posizione salvata da un trascinamento precedente.
  useEffect(() => {
    const salvata = window.localStorage.getItem(CHIAVE_POSIZIONE);
    if (!salvata) return;
    try {
      setPos(JSON.parse(salvata));
    } catch {
      // posizione salvata corrotta: resta il default CSS
    }
  }, []);

  async function carica() {
    const righe = await elencaMieDomande();
    setDomande(righe);
    const ultimoAggiornamento = righe.reduce((max, d) => {
      const t = d.risposto_at ?? d.creato_at;
      return t > max ? t : max;
    }, "");
    const visto = window.localStorage.getItem(CHIAVE_VISTO) ?? "";
    setNonVisti(!!ultimoAggiornamento && ultimoAggiornamento > visto);
  }

  useEffect(() => {
    carica();
  }, []);

  // Polling leggero solo mentre c'è qualcosa ancora senza risposta e la
  // chat è aperta — si ferma da solo appena tutto è risolto.
  useEffect(() => {
    if (!aperto) return;
    if (!domande.some(inAttesa)) return;
    const id = setInterval(carica, 4000);
    return () => clearInterval(id);
  }, [aperto, domande]);

  useEffect(() => {
    if (aperto) {
      window.localStorage.setItem(CHIAVE_VISTO, new Date().toISOString());
      setNonVisti(false);
      corpoRef.current?.scrollTo({ top: corpoRef.current.scrollHeight });
    }
  }, [aperto, domande]);

  // La posizione base per il calcolo del trascinamento viene letta dal DOM
  // reale (getBoundingClientRect), non dallo state: così funziona anche la
  // primissima volta, quando pos è ancora null e il bottone è posizionato
  // solo via CSS (basso a destra).
  function iniziaTrascinamento(e: React.PointerEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const baseX = pos?.x ?? rect.left;
    const baseY = pos?.y ?? rect.top;
    trascinamento.current = {
      startX: e.clientX,
      startY: e.clientY,
      dx: e.clientX - baseX,
      dy: e.clientY - baseY,
      mosso: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function trascina(e: React.PointerEvent) {
    const t = trascinamento.current;
    if (!t) return;
    if (!t.mosso) {
      if (Math.abs(e.clientX - t.startX) < 4 && Math.abs(e.clientY - t.startY) < 4) return;
      t.mosso = true;
    }
    const nx = Math.min(Math.max(e.clientX - t.dx, 8), window.innerWidth - 64);
    const ny = Math.min(Math.max(e.clientY - t.dy, 8), window.innerHeight - 64);
    setPos({ x: nx, y: ny });
  }

  function fineTrascinamento() {
    const t = trascinamento.current;
    if (!t) return;
    if (!t.mosso) {
      setAperto((v) => !v);
    } else {
      setPos((attuale) => {
        if (attuale) window.localStorage.setItem(CHIAVE_POSIZIONE, JSON.stringify(attuale));
        return attuale;
      });
    }
    trascinamento.current = null;
  }

  function invia(e: React.FormEvent) {
    e.preventDefault();
    const domanda = testo.trim();
    if (!domanda || invio) return;
    setInvio(true);
    setTesto("");
    inviaDomanda(domanda)
      .then((res) => {
        if (!res.ok) {
          setTesto(domanda);
          return;
        }
        return carica();
      })
      .finally(() => setInvio(false));
  }

  function chiamaCoordinatore(id: string) {
    setDomande((prev) => prev.map((d) => (d.id === id ? { ...d, richiede_coordinatore: true } : d)));
    richiediCoordinatore(id).then(() => carica());
  }

  return (
    <>
      <button
        onPointerDown={iniziaTrascinamento}
        onPointerMove={trascina}
        onPointerUp={fineTrascinamento}
        aria-label="Domande e supporto"
        style={pos ? { left: pos.x, top: pos.y } : undefined}
        className={`fixed z-40 flex h-14 w-14 touch-none items-center justify-center rounded-full bg-tt-blue text-white shadow-[0_10px_30px_-6px_rgba(23,40,55,.4)] active:scale-95 ${
          pos ? "" : "bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-6"
        }`}
      >
        <span className="text-2xl font-semibold leading-none">?</span>
        {nonVisti && (
          <span className="absolute right-0 top-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-red-500" />
        )}
      </button>

      {aperto && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[560px] sm:w-[380px] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-[0_20px_60px_-12px_rgba(23,40,55,.35)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-3">
            <div>
              <p className="text-sm font-semibold">Domande</p>
              <p className="text-xs text-slate-400">Come possiamo aiutarti?</p>
            </div>
            <button
              onClick={() => setAperto(false)}
              aria-label="Chiudi"
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={corpoRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {domande.length === 0 && (
              <p className="mt-8 text-center text-sm text-slate-400">
                Scrivi qui la tua prima domanda al Coordinatore.
              </p>
            )}
            {domande.map((d) => (
              <MessaggioDomanda key={d.id} domanda={d} onChiamaCoordinatore={() => chiamaCoordinatore(d.id)} />
            ))}
          </div>

          <form
            onSubmit={invia}
            className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3"
          >
            <textarea
              value={testo}
              onChange={(e) => setTesto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  invia(e);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Scrivi un messaggio…"
              className="max-h-24 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-tt-blue focus:outline-none focus:ring-2 focus:ring-tt-blue/20"
            />
            <button
              type="submit"
              disabled={invio || !testo.trim()}
              aria-label="Invia"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tt-blue text-white disabled:opacity-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M3 11l18-8-8 18-2-8-8-2z" />
              </svg>
            </button>

            {/* Trasparenza: chi scrive deve sapere che la domanda viene ordinata
                da un sistema automatico, e chi scrive la risposta. Il secondo
                periodo tiene fuori dal trattamento le categorie particolari
                dell'art. 9 GDPR, che in un campo di testo libero possono finire
                senza che nessuno lo voglia. */}
            <p className="w-full text-[11px] leading-snug text-slate-400">
              La tua domanda viene ordinata da un sistema automatico; a risponderti è
              sempre una persona. Non scrivere dati di salute o documenti.
            </p>
          </form>
        </div>
      )}
    </>
  );
}

function MessaggioDomanda({
  domanda,
  onChiamaCoordinatore,
}: {
  domanda: RigaDomandaSupporto;
  onChiamaCoordinatore: () => void;
}) {
  // Il tasto per chiamare il Coordinatore c'è finché la domanda è senza risposta
  // e non gli è già stata inoltrata. Prima viveva dentro la bolla dell'IA, che è
  // stata tolta: l'IA non scrive risposte, quindi quella bolla non poteva
  // accendersi — e il tasto, che invece serve, resta qui.
  const puoChiamareCoordinatore = !domanda.risposta && !domanda.richiede_coordinatore;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-tt-blue px-3 py-2 text-sm text-white">
          {domanda.domanda}
        </p>
      </div>

      {!domanda.risposta && (
        <>
          {domanda.richiede_coordinatore ? (
            <p className="ml-1 text-xs text-amber-700">Il Coordinatore è stato avvisato.</p>
          ) : domanda.categoria_ia === null ? (
            <p className="ml-1 text-xs text-slate-400">Sto pensando…</p>
          ) : (
            <p className="ml-1 text-xs text-slate-400">In attesa di una risposta…</p>
          )}
          {puoChiamareCoordinatore && (
            <button
              onClick={onChiamaCoordinatore}
              className="ml-1 block text-xs font-medium text-tt-blue-600 hover:underline"
            >
              Non mi basta, parla col Coordinatore →
            </button>
          )}
        </>
      )}

      {domanda.risposta && (
        <div className="flex justify-start">
          <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-tt-blue-50 px-3 py-2 text-sm text-slate-700">
            <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-tt-blue-600">
              Coordinatore
            </span>
            {domanda.risposta}
          </p>
        </div>
      )}
    </div>
  );
}
