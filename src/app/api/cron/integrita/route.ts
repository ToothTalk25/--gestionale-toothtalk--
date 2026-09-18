import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { richiestaAutorizzataCron } from "@/lib/api-auth";
import { inviaEmailGmail } from "@/lib/mail";
import { inviaPushAdmin } from "@/lib/push";

export const dynamic = "force-dynamic";

type Controllo = {
  id: string;
  eseguita_at: string;
  origine: string;
  esito: string;
  deliverable_controllate: number;
  versioni_controllate: number;
  catene_rotte: number;
  pacchetti_controllati: number;
  manifesti_rotti: number;
  file_mancanti: number;
  file_dimensione_diversa: number;
  problemi: unknown;
  notificata_at: string | null;
};

/**
 * Ogni giorno, subito dopo la sveglia notturna del database: se il controllo
 * d'integrità ha trovato problemi, avvisa l'accesso globale — email e
 * notifica — una volta sola.
 *
 * Se il database non ha lasciato nessuna riga recente (per esempio perché
 * pg_cron non è disponibile sul progetto), il controllo lo lancia questa
 * route: la garanzia non dipende da quale delle due sveglie suona.
 *
 * Non controlla l'integrità qui: quello lo fa la funzione nel database
 * (controlla_integrita), che è anche l'unico posto in cui il risultato viene
 * scritto. Questa route legge e avvisa.
 */
export async function GET(request: NextRequest) {
  if (!richiestaAutorizzataCron(request)) {
    return NextResponse.json({ ok: false, errore: "non autorizzato" }, { status: 401 });
  }

  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const ultimo = async (): Promise<Controllo | null> => {
      const { data } = await admin
        .from("controlli_integrita")
        .select("*")
        .order("eseguita_at", { ascending: false })
        .limit(1);
      return (data?.[0] as Controllo) ?? null;
    };

    let controllo = await ultimo();
    let eseguitoOra = false;

    // Nessun controllo recente (la sveglia del database non ha suonato): lo
    // lancia questa route, con la stessa funzione.
    const vecchio =
      !controllo || Date.now() - new Date(controllo.eseguita_at).getTime() > 20 * 60 * 60 * 1000;
    if (vecchio) {
      const { error } = await admin.rpc("controlla_integrita", { p_origine: "cron-vercel" });
      if (error) {
        console.error("controllo integrità dal cron fallito:", error.message);
        return NextResponse.json({ ok: false, errore: error.message }, { status: 500 });
      }
      eseguitoOra = true;
      controllo = await ultimo();
    }

    if (!controllo) {
      return NextResponse.json({ ok: true, eseguitoOra, esito: "nessun controllo" });
    }

    if (controllo.esito !== "problemi") {
      return NextResponse.json({
        ok: true,
        eseguitoOra,
        esito: controllo.esito,
        avviso: false,
        controllati: {
          versioni: controllo.versioni_controllate,
          pacchetti: controllo.pacchetti_controllati,
        },
      });
    }

    // Problemi trovati: si avvisa una volta sola. La riga dice già a chi
    // legge che l'avviso è partito (notificata_at), quindi un secondo giro
    // dello stesso cron non rispedisce niente.
    if (controllo.notificata_at) {
      return NextResponse.json({ ok: true, eseguitoOra, esito: "problemi", avviso: false, motivo: "già avvisato" });
    }

    const problemi = Array.isArray(controllo.problemi) ? (controllo.problemi as Record<string, unknown>[]) : [];
    const righe = [
      "Il controllo automatico dell'integrità ha trovato qualcosa che non torna.",
      "",
      `Controllo del ${new Date(controllo.eseguita_at).toLocaleString("it-IT")}`,
      `  versioni ricontrollate: ${controllo.versioni_controllate}`,
      `  pacchetti sigillati ricontrollati: ${controllo.pacchetti_controllati}`,
      `  catene di impronte rotte: ${controllo.catene_rotte}`,
      `  manifesti che non tornano: ${controllo.manifesti_rotti}`,
      `  file mancanti: ${controllo.file_mancanti}`,
      `  file con dimensione diversa: ${controllo.file_dimensione_diversa}`,
      "",
      "Dettaglio:",
      ...problemi.slice(0, 30).map((p) => `  • ${JSON.stringify(p)}`),
      "",
      "Cosa fare: apri il Registro, sezione \"Integrità dei depositi\". Non è un",
      "guasto del gestionale ma un dato che non corrisponde alla propria impronta:",
      "finché non è chiarito, non considerare quel materiale come certificato.",
      "",
      "Messaggio generato automaticamente dal gestionale ToothTalk.",
      "",
    ];

    const { data: amministratori } = await admin
      .from("profiles")
      .select("email")
      .eq("role", "admin")
      .eq("attivo", true);

    let recapito = false;
    for (const a of amministratori ?? []) {
      if (!a.email) continue;
      const inviata = await inviaEmailGmail({
        destinatario: a.email,
        oggetto: "[ToothTalk] Controllo integrità: qualcosa non torna",
        testo: righe.join("\n"),
      });
      recapito = recapito || inviata;
    }

    // Notifica sul telefono: best-effort (inviaPushAdmin non lancia mai).
    await inviaPushAdmin({
      title: "Integrità: qualcosa non torna",
      body: `${controllo.catene_rotte} catene rotte, ${controllo.manifesti_rotti} manifesti, ${controllo.file_mancanti} file mancanti.`,
      url: "/admin",
    });

    await admin
      .from("controlli_integrita")
      .update({ notificata_at: new Date().toISOString() })
      .eq("id", controllo.id);

    return NextResponse.json({ ok: true, eseguitoOra, esito: "problemi", avviso: recapito });
  } catch (e) {
    console.error("cron integrita fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
