import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieDaImpostare = { name: string; value: string; options: CookieOptions };

const PUBBLICHE = [
  "/login",
  "/auth",
  "/privacy",
  "/termini",
  "/registrati",
  // File di verifica proprietà dominio (Google Search Console): statico,
  // nessun dato sensibile, deve restare raggiungibile senza sessione.
  "/google97604b8436f2db92.html",
];

// Flag di sicurezza rigidi per i cookie di sessione (HttpOnly, Secure,
// SameSite=Strict): il token non vive in localStorage e non viaggia in
// contesti cross-site.
const COOKIE_SICURI: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
};

// In Next 16 questa convenzione si chiama "proxy" (era "middleware").
// Gira su OGNI richiesta: rinnova il token di sessione Supabase e respinge
// verso /login chi non è autenticato, prima ancora che una pagina venga resa.
export async function proxy(request: NextRequest) {
  // Gli endpoint /api/* (cron Vercel) sono chiamati senza sessione: il
  // matcher non li esclude in modo affidabile, quindi li lasciamo passare
  // subito, prima di ogni controllo di autenticazione.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieDaImpostare[]) {
          for (const { name, value, options } of cookiesToSet) {
            const opts = { ...options, ...COOKIE_SICURI };
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            const opts = { ...options, ...COOKIE_SICURI };
            response.cookies.set(name, value, opts);
          }
        },
      },
    },
  );

  // Rinnova il token di sessione a ogni richiesta. getUser() farebbe una
  // chiamata HTTP a Supabase su OGNI richiesta (anche su ogni asset) e in
  // mobile la latenza si sente subito: getSession() legge solo i cookie
  // locali, è istantaneo. La validazione reale del token la fa la pagina
  // (getSessionContext), dove la sessione arriva comunque già fresca.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = request.nextUrl.pathname;
  const pubblica = PUBBLICHE.some((p) => path.startsWith(p));

  if (!session && !pubblica) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Il pathname corrente serve al layout app per il blocco accordo
  // (senza aggiungere query extra a ogni richiesta).
  response.headers.set("x-pathname", path);

  return response;
}

export const config = {
  // manifest.json, sw.js, /api/* e gli asset statici devono restare
  // raggiungibili senza sessione: i cron Vercel chiamano /api senza login,
  // il browser chiede manifest/sw per la PWA, e le immagini non vanno
  // intercettate dal redirect di autenticazione.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
