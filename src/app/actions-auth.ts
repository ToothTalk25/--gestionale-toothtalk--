"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getSessionContext, destinazioneIngresso } from "@/lib/auth";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

/**
 * Login lato server. Deve passare da qui e non dal client: il cookie di
 * sessione è HttpOnly (src/lib/supabase/server.ts), quindi solo il server
 * può sovrascriverlo. Se il login viene fatto con il client Supabase del
 * browser, che scrive via document.cookie, un cookie HttpOnly già presente
 * (es. una sessione admin ancora attiva sullo stesso browser) non viene
 * toccato: si resta loggati come prima, qualunque credenziale si invii.
 *
 * Restituisce anche la destinazione corretta (calcolata qui, subito dopo
 * il login, con le stesse regole del layout del gruppo (app)): il client
 * naviga dritto lì invece di passare sempre da /dashboard e farsi
 * rimandare indietro dal layout quando l'accordo non è completo — quel
 * redirect server-side a metà di una transizione client mandava il router
 * di Next.js 16 in un loop di richieste continue in produzione.
 */
export async function accedi(email: string, password: string): Promise<Esito<{ destinazione: string }>> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, errore: "Credenziali non valide." };
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, errore: "Accesso riuscito ma profilo non trovato. Contatta chi gestisce il Gestionale." };
  return { ok: true, dati: { destinazione: destinazioneIngresso(ctx) } };
}

/** Stesso motivo di accedi(): solo il server può ripulire un cookie HttpOnly. */
export async function esci(): Promise<Esito> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return { ok: true, dati: undefined };
}
