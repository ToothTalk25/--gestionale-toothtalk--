import { NextResponse, type NextRequest } from "next/server";
import { segretoValido } from "@/lib/api-auth";
import { generaRiepilogoGestionale } from "@/lib/gestionale/riepilogo";

export const dynamic = "force-dynamic";

/**
 * Stato operativo del gestionale in JSON, pensato per essere letto da un
 * task esterno (es. il briefing giornaliero su Notion) che non ha accesso
 * diretto al database — stessa logica di /api/cron/report-settimanale, ma
 * risposta strutturata invece di un'email. Protetto da una chiave
 * condivisa, non dalla sessione utente: chi chiama questo endpoint non è
 * mai loggato nel gestionale.
 *
 * La chiave va SOLO nell'header `Authorization: Bearer <BRIEFING_API_KEY>`:
 * in query string finirebbe nei log dei proxy e nella history — un segreto
 * in un URL è un segreto esposto. (In passato era accettato anche ?key=…,
 * rimosso per questo motivo: se il chiamante esterno usa ancora l'URL,
 * va aggiornato all'header.)
 *
 * La generazione del riepilogo vive in lib/gestionale/riepilogo.ts, condivisa
 * con /api/cron/push-notion-briefing: stessa fonte, nessuna copia a mano.
 */
export async function GET(request: NextRequest) {
  const chiave = process.env.BRIEFING_API_KEY;
  const auth = request.headers.get("authorization") ?? "";
  const valore = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const autorizzato = !!chiave && segretoValido(valore, chiave);

  if (!autorizzato) {
    return NextResponse.json({ ok: false, errore: "non autorizzato" }, { status: 401 });
  }

  try {
    const riepilogo = await generaRiepilogoGestionale();
    return NextResponse.json({ ok: true, ...riepilogo });
  } catch (e) {
    console.error("briefing-gestionale fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
