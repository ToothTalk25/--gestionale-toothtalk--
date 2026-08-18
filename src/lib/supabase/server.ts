import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieDaImpostare = { name: string; value: string; options: CookieOptions };

/**
 * Cookie di sessione con flag di sicurezza rigidi: HttpOnly, Secure e
 * SameSite=Strict. Il token di sessione Supabase non vive mai in
 * localStorage (dove un XSS potrebbe leggerlo), solo in questi cookie.
 * SameSite=Strict limita l'invio ai contesti first-party: previene
 * CSRF e mitigherebbe il furto di sessione via cross-site.
 */
const COOKIE_SICURI: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
};

/** Applica i flag di sicurezza a ogni cookie di sessione che Supabase imposta. */
function rendiSicuri(cookiesToSet: CookieDaImpostare[]): CookieDaImpostare[] {
  return cookiesToSet.map(({ name, value, options }) => ({
    name,
    value,
    options: { ...options, ...COOKIE_SICURI },
  }));
}

/**
 * Client Supabase per Server Component / Server Action.
 * Usa la anon key: ogni query passa comunque dalla RLS con il JWT dell'utente.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieDaImpostare[]) {
          try {
            for (const { name, value, options } of rendiSicuri(cookiesToSet)) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Chiamato da un Server Component: il refresh del cookie lo fa
            // il middleware, qui si può ignorare.
          }
        },
      },
    },
  );
}
