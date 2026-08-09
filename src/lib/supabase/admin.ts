import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Client con SERVICE ROLE: bypassa la RLS.
 *
 * Usato in un solo punto dell'applicazione — la registrazione dell'esito
 * di una spedizione PEC — perché quella scrittura deve essere impossibile
 * dal browser: se un membro potesse marcare un pacchetto come "PEC inviata"
 * senza spedirla, il valore probatorio del sistema svanirebbe.
 *
 * Non importarlo mai da un componente client.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY non configurata");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
