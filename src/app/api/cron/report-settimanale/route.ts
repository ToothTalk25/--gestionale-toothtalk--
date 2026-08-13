import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { inviaEmailGmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * Report settimanale all'admin: quanti pacchetti sono in attesa di
 * revisione, quanti sigillati, quanti progetti aperti. Lo scopo è dare
 * all'admin il quadro della settimana senza aprire il gestionale.
 */
export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1. Email dell'admin (destinatario del report)
    const { data: adminProfiles } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("role", "admin")
      .eq("attivo", true)
      .limit(1);

    // 2. Conteggi per stato pacchetto
    const { count: inRevisione } = await admin
      .from("pacchetti_video")
      .select("*", { count: "exact", head: true })
      .eq("stato", "pronto");

    const { count: sigillati } = await admin
      .from("pacchetti_video")
      .select("*", { count: "exact", head: true })
      .in("stato", ["sigillato", "pec_inviata", "pec_confermata"]);

    const { count: pecErrore } = await admin
      .from("pacchetti_video")
      .select("*", { count: "exact", head: true })
      .eq("stato", "pec_errore");

    const { count: richiesteAperte } = await admin
      .from("richieste_modifica")
      .select("*", { count: "exact", head: true })
      .in("stato", ["aperta", "da_verificare"]);

    const destinatario = adminProfiles?.[0]?.email;
    if (!destinatario) {
      return NextResponse.json({ ok: false, motivo: "nessun admin attivo" });
    }

    const testo =
      `Riepilogo settimanale ToothTalk\n` +
      `===============================\n\n` +
      `• Pacchetti in attesa di revisione: ${inRevisione ?? 0}\n` +
      `• Pacchetti sigillati / certificati: ${sigillati ?? 0}\n` +
      `• PEC in errore (da verificare): ${pecErrore ?? 0}\n` +
      `• Richieste di modifica aperte: ${richiesteAperte ?? 0}\n\n` +
      `Apri il gestionale per i dettagli: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}\n\n` +
      `— ToothTalk (messaggio automatico)`;

    await inviaEmailGmail({ destinatario, oggetto: "Riepilogo settimanale — ToothTalk", testo });

    return NextResponse.json({ ok: true, destinatario });
  } catch (e) {
    console.error("report-settimanale fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
