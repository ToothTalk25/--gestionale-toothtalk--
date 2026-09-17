import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { accordoCompleto, accordoScaduto, type ProfiloAccordo } from "@/lib/accordo";

type CookieDaImpostare = { name: string; value: string; options: CookieOptions };

const PUBBLICHE = [
  "/login",
  "/auth",
  "/privacy",
  "/termini",
  "/registrati",
  // Link di reset password ricevuto via email: arriva con ?code= (flusso
  // PKCE di @supabase/ssr) e chi clicca NON ha ancora una sessione — la
  // ottiene solo dopo che il client scambia il code, cosa che può fare
  // solo se il proxy lo lascia arrivare alla pagina invece di rimandarlo
  // subito al login.
  "/aggiorna-password",
  // Firma della liberatoria da parte di chi è stato intervistato: non ha
  // (e non deve avere) un account nel gestionale, riceve solo un link con
  // token via email. Senza questa riga il proxy lo rimandava al login,
  // rendendo l'intero flusso di firma digitale irraggiungibile.
  "/carica-liberatoria",
  // Pagina di benvenuto raggiunta dal link di onboarding inviato via email
  // (sezione admin "Invia link di accesso"): chi la apre non ha ancora un
  // account, quindi non può avere una sessione.
  "/benvenuto",
  // File di verifica proprietà dominio (Google Search Console): statico,
  // nessun dato sensibile, deve restare raggiungibile senza sessione.
  "/google97604b8436f2db92.html",
];

/**
 * Pagine che NON richiedono l'accordo completo: sono i posti dove chi non ha
 * l'accordo può (o deve) stare — il profilo dove lo carica, il rinnovo quando
 * l'accordo è scaduto, l'uscita per la conferma Art. 9.4, la pagina del
 * Collaboratore Tecnico che non ha accordo per definizione.
 */
const SENZA_BLOCCO_ACCORDO = ["/profilo", "/rinnovo", "/uscita", "/tecnico"];

// Flag di sicurezza per i cookie di sessione: Secure, SameSite=Strict e
// HttpOnly. Il token non vive in localStorage, non viaggia in contesti
// cross-site e non è leggibile da JavaScript (un eventuale XSS non può
// rubare la sessione). Gli upload dei file grandi vanno comunque dal
// browser dritti a Supabase Storage, ma con un URL firmato una tantum
// generato da preparaUpload (server action) invece che con la sessione
// letta direttamente dal client — vedi src/components/UploadDeliverable.tsx
// e src/lib/supabase/server.ts.
const COOKIE_SICURI: CookieOptions = {
  secure: true,
  sameSite: "strict",
  httpOnly: true,
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

  // ---------------------------------------------------- blocco dell'Accordo
  // Questo controllo NON può vivere solo nel layout del gruppo (app): Next.js
  // non riesegue un layout quando si naviga fra rotte che lo condividono,
  // quindi con un clic dal profilo (o dal footer, che punta alla Libreria) si
  // arrivava a una pagina dell'app senza aver caricato l'accordo — successo
  // davvero in produzione. Qui passa OGNI richiesta, comprese le navigazioni
  // fatte coi link interni, quindi la regola non è aggirabile dall'interfaccia.
  // Costo: una lettura di una riga di profilo per richiesta autenticata, che
  // per questo progetto (poche decine di persone) è trascurabile.
  if (session && !pubblica && !SENZA_BLOCCO_ACCORDO.some((p) => path.startsWith(p))) {
    const { data: profilo } = await supabase
      .from("profiles")
      .select(
        "role, attivo, accordo_path, accordo_letto_confermato, accordo_verificato, accordo_approvato_admin_at, accordo_controfirmato_path, accordo_controfirma_confermata_at, accordo_scadenza",
      )
      .eq("id", session.user.id)
      .maybeSingle<ProfiloAccordo & { role: string; attivo: boolean; accordo_scadenza: string | null }>();

    // Profilo illeggibile (sessione non valida) o non attivo: non decidiamo
    // nulla qui, se ne occupano getSessionContext e il layout come prima.
    if (profilo?.attivo) {
      const vaiA = (destinazione: string) => {
        const url = request.nextUrl.clone();
        url.pathname = destinazione;
        url.search = "";
        return NextResponse.redirect(url);
      };

      if (profilo.role === "tecnico") return vaiA("/tecnico");
      if (profilo.role !== "admin") {
        if (!accordoCompleto(profilo, false)) return vaiA("/profilo");
        if (accordoScaduto(profilo.accordo_scadenza)) return vaiA("/rinnovo");
      }
    }
  }

  return response;
}

export const config = {
  // manifest.json, sw.js, /api/* e gli asset statici devono restare
  // raggiungibili senza sessione: i cron Vercel chiamano /api senza login,
  // il browser chiede manifest/sw per la PWA, e le immagini non vanno
  // intercettate dal redirect di autenticazione.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
