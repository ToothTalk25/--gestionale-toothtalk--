import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { inviaEmailGmail } from "@/lib/mail";
import { richiestaAutorizzataCron } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Report settimanale all'admin: oltre ai conteggi, una sezione "gestionale"
 * con lo stato operativo del flusso di lavoro (pacchetti da sigillare, PEC
 * da inviare, richieste di modifica aperte) così l'admin può collegarlo al
 * proprio briefing senza aprire il gestionale.
 */
export async function GET(request: NextRequest) {
  if (!richiestaAutorizzataCron(request)) {
    return NextResponse.json({ ok: false, errore: "non autorizzato" }, { status: 401 });
  }

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

    const destinatario = adminProfiles?.[0]?.email;
    if (!destinatario) {
      return NextResponse.json({ ok: false, motivo: "nessun admin attivo" });
    }

    // 2. Sezione gestionale — stato operativo
    // 2a. Pacchetti pronti da rivedere (da sigillare o rimandare)
    const { data: daSigillare } = await admin
      .from("v_video_da_rivedere")
      .select("gruppo, progetto, richieste_aperte")
      .eq("stato", "pronto")
      .order("gruppo");

    // 2b. Sigillati ma PEC non ancora inviata
    const { data: pecDaInviare } = await admin
      .from("v_video_da_rivedere")
      .select("gruppo, progetto")
      .eq("stato", "sigillato")
      .order("gruppo");

    // 2c. Richieste di modifica aperte o da verificare, tutti i gruppi
    const { data: richiesteModifica } = await admin
      .from("richieste_modifica")
      .select("stato, creata_at, titolo: tasks!inner(titolo), gruppo: tasks!inner(poli!inner(nome))")
      .in("stato", ["aperta", "da_verificare"])
      .order("creata_at");

    // 2d. Profili uscenti: promemoria (solo informativo, nessuna azione automatica)
    const { data: uscenti } = await admin
      .from("profiles")
      .select("id, email, updated_at")
      .eq("attivo", false)
      .lt("updated_at", new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(50);

    // 3. Conteggi
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

    const { count: richiesteAperteCount } = await admin
      .from("richieste_modifica")
      .select("*", { count: "exact", head: true })
      .in("stato", ["aperta", "da_verificare"]);

    // 4. Compone il testo del briefing
    const righe: string[] = [];
    righe.push("Riepilogo settimanale ToothTalk™");
    righe.push("===============================");
    righe.push("");

    const daSigillareLista = daSigillare ?? [];
    const pecLista = pecDaInviare ?? [];
    const modLista = (richiesteModifica ?? []).map((r: any) => ({
      gruppo: r.gruppo?.poli?.nome ?? "—",
      progetto: r.titolo?.titolo ?? "—",
      stato: r.stato,
    }));

    const tuttoVuoto =
      daSigillareLista.length === 0 && pecLista.length === 0 && modLista.length === 0;

    if (tuttoVuoto) {
      righe.push("Nessun progetto in attesa.");
    } else {
      if (daSigillareLista.length > 0) {
        righe.push("Da sigillare:");
        for (const p of daSigillareLista) {
          const extra = p.richieste_aperte > 0 ? ` (${p.richieste_aperte} richieste aperte)` : "";
          righe.push(`  • ${p.gruppo} — ${p.progetto}${extra}`);
        }
        righe.push("");
      }
      if (pecLista.length > 0) {
        righe.push("PEC da inviare:");
        for (const p of pecLista) {
          righe.push(`  • ${p.gruppo} — ${p.progetto}`);
        }
        righe.push("");
      }
      if (modLista.length > 0) {
        righe.push("Richieste di modifica aperte:");
        for (const r of modLista) {
          const stato = r.stato === "da_verificare" ? "da verificare" : r.stato;
          righe.push(`  • ${r.gruppo} — ${r.progetto} (${stato})`);
        }
        righe.push("");
      }
    }

    righe.push("");
    // Promemoria profili uscenti (SOLO informativo, nessuna azione automatica)
    const uscentiLista = uscenti ?? [];
    if (uscentiLista.length > 0) {
      righe.push(`Profili uscenti da oltre 180 giorni: ${uscentiLista.length}`);
      for (const u of uscentiLista.slice(0, 5)) {
        const giorni = Math.floor(
          (Date.now() - new Date(u.updated_at).getTime()) / (24 * 60 * 60 * 1000),
        );
        righe.push(`  • ${u.email} — inattivo da ~${giorni} giorni`);
      }
      righe.push(
        "Nessuna cancellazione automatica: gestione manuale dal Registro (sezione 'Profili uscenti').",
      );
      righe.push("");
    }
    righe.push(`Totale: ${inRevisione ?? 0} in revisione · ${sigillati ?? 0} sigillati · ${pecErrore ?? 0} PEC in errore · ${richiesteAperteCount ?? 0} richieste aperte`);
    righe.push(`Apri il gestionale: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}`);
    righe.push("");
    righe.push("— ToothTalk™ (messaggio automatico)");

    await inviaEmailGmail({
      destinatario,
      oggetto: "Riepilogo settimanale — ToothTalk™",
      testo: righe.join("\n"),
    });

    return NextResponse.json({ ok: true, destinatario });
  } catch (e) {
    console.error("report-settimanale fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
