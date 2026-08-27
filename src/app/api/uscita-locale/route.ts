import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Chiamato da ControlloRicordami alla chiusura di scheda/browser quando
// "Ricordami" non è spuntato. Non è una Server Action perché su
// pagehide/beforeunload il browser interrompe le richieste in corso: solo
// un fetch con keepalive (come qui) sopravvive alla chiusura della pagina.
// Il cookie di sessione è HttpOnly: solo il server può ripulirlo davvero,
// il client Supabase del browser (document.cookie) non ci riesce.
export async function POST() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
}
