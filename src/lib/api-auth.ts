import type { NextRequest } from "next/server";

/**
 * Verifica che una richiesta a un endpoint "interno" (cron, briefing) sia
 * davvero autorizzata: `Authorization: Bearer <CRON_SECRET>`, chiave
 * condivisa configurata su Vercel. Quando CRON_SECRET è impostata, Vercel
 * la allega da solo alle richieste generate dai cron di vercel.json — non
 * serve altro per riconoscerle.
 *
 * NON basarsi sulla sola presenza dell'header `x-vercel-cron`: verificato
 * dal vivo (curl esterno, nessun accesso privilegiato) che Vercel non lo
 * filtra dalle richieste normali in arrivo — chiunque può forgiarlo, non è
 * un segnale affidabile. Un controllo di sola presenza era esattamente
 * l'equivalente di non avere autenticazione.
 *
 * Prima di questa blindatura le route /api/cron/* erano GET pubbliche:
 * chiunque potesse indovinare l'URL poteva far scattare email, scadenze o
 * retry usando la service role key.
 */
export function richiestaAutorizzataCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
