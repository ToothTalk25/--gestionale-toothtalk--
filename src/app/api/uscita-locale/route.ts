import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Chiamato da ControlloRicordami alla chiusura di scheda/browser quando
// "Ricordami" non è spuntato. Non è una Server Action perché su
// pagehide/beforeunload il browser interrompe le richieste in corso: solo
// un fetch con keepalive (come qui) sopravvive alla chiusura della pagina.
// Il cookie di sessione è HttpOnly: solo il server può ripulirlo davvero,
// il client Supabase del browser (document.cookie) non ci riesce.
export async function POST(request: NextRequest) {
  // Anti-CSRF: una pagina di terze parti non deve poter costringere la
  // chiusura della sessione dell'utente. La risposta a questo POST azzera i
  // cookie di sessione: anche senza SameSite sulle richieste in uscita,
  // l'attaccante riceverebbe i Set-Cookie di scarto e scollegherebbe la
  // vittima (DoS da logout). Il browser allega sempre Origin alle POST:
  // se l'origine non è la nostra, rifiutiamo.
  const origine = request.headers.get("origin");
  if (origine) {
    let stessa = false;
    try {
      stessa = new URL(origine).host === request.nextUrl.host;
    } catch {
      stessa = false;
    }
    if (!stessa) {
      return NextResponse.json({ ok: false, errore: "origine non consentita" }, { status: 403 });
    }
  }

  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
}

