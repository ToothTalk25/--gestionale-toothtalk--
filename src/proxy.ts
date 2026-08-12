import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieDaImpostare = { name: string; value: string; options: CookieOptions };

const PUBBLICHE = ["/login", "/auth"];

// In Next 16 questa convenzione si chiama "proxy" (era "middleware").
// Gira su OGNI richiesta: rinnova il token di sessione Supabase e respinge
// verso /login chi non è autenticato, prima ancora che una pagina venga resa.
export async function proxy(request: NextRequest) {
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
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Rinnova il token di sessione a ogni richiesta.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const pubblica = PUBBLICHE.some((p) => path.startsWith(p));

  if (!user && !pubblica) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // manifest.json e sw.js devono restare raggiungibili senza sessione: il
  // browser li richiede per valutare l'installabilità della PWA, prima
  // ancora che chi guarda abbia fatto login (o senza mai farlo, se guarda
  // solo la scheda del browser).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
