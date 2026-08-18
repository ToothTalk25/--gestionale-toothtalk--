import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { inviaEmailGmail } from "@/lib/mail";
import { richiestaAutorizzataCron } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Ogni ora: le richieste di liberatoria scadute e mai firmate passano da
 * 'inviata' a 'scaduta', così non restano pendenti e il token non è più
 * usabile. Avvisa l'admin se ce n'erano.
 */
export async function GET(request: NextRequest) {
  if (!richiestaAutorizzataCron(request)) {
    return NextResponse.json({ ok: false, errore: "non autorizzato" }, { status: 401 });
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // Trova le scadute ancora 'inviata'
    const { data: scadute } = await admin
      .from("richieste_liberatoria")
      .select("id, task_id, contatto_email")
      .eq("stato", "inviata")
      .lt("scade_at", new Date().toISOString());

    const n = scadute?.length ?? 0;
    if (n > 0) {
      const { error } = await admin
        .from("richieste_liberatoria")
        .update({ stato: "scaduta" })
        .eq("stato", "inviata")
        .lt("scade_at", new Date().toISOString());
      if (error) console.error("aggiornamento scadute fallito:", error.message);
    }

    // Avviso all'admin se qualcosa è scaduto
    if (n > 0) {
      const { data: adminProfiles } = await admin
        .from("profiles")
        .select("email")
        .eq("role", "admin")
        .eq("attivo", true)
        .limit(1);
      const destinatario = adminProfiles?.[0]?.email;
      if (destinatario) {
        await inviaEmailGmail({
          destinatario,
          oggetto: "Liberatorie scadute — ToothTalk",
          testo:
            `${n} richiesta/e di liberatoria è/sono scaduta/e senza essere firmata/e ` +
            `ed è stata marcata come "scaduta".\n\n` +
            `Puoi reinviare il link dal gestionale se serve.\n\n` +
            `— ToothTalk (messaggio automatico)`,
        });
      }
    }

    return NextResponse.json({ ok: true, scadute: n });
  } catch (e) {
    console.error("liberatorie-scadute fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
