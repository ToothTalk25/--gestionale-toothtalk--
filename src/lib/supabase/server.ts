import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieDaImpostare = { name: string; value: string; options: CookieOptions };

/**
 * Cookie di sessione con tutti i flag di sicurezza: Secure, SameSite=Strict
 * e HttpOnly. Il token di sessione Supabase non vive mai in localStorage né
 * è leggibile da JavaScript: solo il server lo tocca. SameSite=Strict limita
 * l'invio ai contesti first-party (mitiga il CSRF); HttpOnly impedisce a un
 * eventuale XSS di leggerlo e rubare la sessione.
 *
 * Gli upload dei file grandi vanno comunque dal browser dritti a Supabase
 * Storage (mai attraverso il server Next, bodySizeLimit in next.config.ts),
 * ma non autenticandosi più con la sessione: preparaUpload (server action,
 * qui il cookie HttpOnly si legge benissimo) firma un URL di caricamento
 * valido una volta sola per quel path esatto — vedi
 * src/components/UploadDeliverable.tsx. Prima HttpOnly andava tolto perché
 * il client Supabase del browser doveva leggersi la sessione da solo per
 * autenticare l'upload diretto: con l'URL firmato non serve più.
 */
const COOKIE_SICURI: CookieOptions = {
  secure: true,
  sameSite: "strict",
  httpOnly: true,
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
