"use server";

import { supabaseServer } from "@/lib/supabase/server";

type Esito = { ok: true } | { ok: false; errore: string };

/**
 * Login lato server. Deve passare da qui e non dal client: il cookie di
 * sessione è HttpOnly (src/lib/supabase/server.ts), quindi solo il server
 * può sovrascriverlo. Se il login viene fatto con il client Supabase del
 * browser, che scrive via document.cookie, un cookie HttpOnly già presente
 * (es. una sessione admin ancora attiva sullo stesso browser) non viene
 * toccato: si resta loggati come prima, qualunque credenziale si invii.
 */
export async function accedi(email: string, password: string): Promise<Esito> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, errore: "Credenziali non valide." };
  return { ok: true };
}

/** Stesso motivo di accedi(): solo il server può ripulire un cookie HttpOnly. */
export async function esci(): Promise<Esito> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return { ok: true };
}
