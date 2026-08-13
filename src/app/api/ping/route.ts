import { NextResponse } from "next/server";

// Endpoint minimo colpito dal cron di Vercel (vercel.json) per tenere calde
// le funzioni serverless: la prima richiesta del mattino non paga il cold
// start. Risponde subito, senza toccare il database.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
