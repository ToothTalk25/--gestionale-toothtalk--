import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Ogni ora: le esportazioni Drive in stato 'errore' (con meno di 5 tentativi)
 * tornano a 'da_fare' così il trigger del DB rilancia la Edge Function
 * esporta-drive. È il retry automatico delle esportazioni fallite.
 */
export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await admin
      .from("esportazioni_drive")
      .update({ stato: "da_fare", ultimo_errore: null, aggiornato_at: new Date().toISOString() })
      .eq("stato", "errore")
      .lt("tentativi", 5)
      .select("id");

    if (error) console.error("retry drive fallito:", error.message);

    return NextResponse.json({ ok: true, rilanciate: data?.length ?? 0 });
  } catch (e) {
    console.error("retry-drive fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
