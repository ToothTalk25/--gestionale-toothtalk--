import type { NextRequest } from "next/server";

/**
 * Verifica che una richiesta a un endpoint "interno" (cron, briefing) sia
 * davvero autorizzata.
 *
 * Due strade, entrambe valide (defense-in-depth):
 *  1. header `x-vercel-cron` — Vercel lo aggiunge in automatico SOLO alle
 *     richieste generate dai cron di vercel.json (nessun chiamante esterno
 *     può forgiarlo in modo affidabile senza il perimetro Vercel);
 *  2. `Authorization: Bearer <CRON_SECRET>` — chiave condivisa configurata
 *     su Vercel, utile per test manuali e per eventuali trigger futuri
 *     esterni al cron.
 *
 * Prima di questa blindatura le route /api/cron/* erano GET pubbliche:
 * chiunque potesse indovinare l'URL poteva far scattare email, scadenze o
 * retry usando la service role key.
 */
export function richiestaAutorizzataCron(request: NextRequest): boolean {
  // 1. Vercel firma le richieste dei cron con questo header.
  if (request.headers.get("x-vercel-cron")) return true;

  // 2. Chiave condivisa in header Authorization (mai in query string).
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
