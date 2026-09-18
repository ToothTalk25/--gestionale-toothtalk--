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

    // PEC in coda (0139): la coda non si svuota da sola — a spedire è il comando
    // sul computer del progetto, che gira da solo ogni 15 minuti (attività
    // it.toothtalk.pec). Si guardano anche le righe in ERRORE: quelle non
    // ripartono da sole e non chiedono niente a nessuno, quindi senza questo
    // controllo resterebbero ferme in silenzio.
    const { data: pecInCoda } = await admin
      .from("pec_da_inviare")
      .select("id, oggetto, destinatari, creato_at, stato, ultimo_errore")
      .in("stato", ["in_coda", "errore"])
      .order("creato_at", { ascending: true });

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
      // Depositi a posto: se però in coda ci sono PEC non ancora spedite, il
      // promemoria parte lo stesso — è una promessa non mantenuta, quei
      // documenti non hanno data certa.
      if (pecInCoda?.length) {
        const daSpedire = pecInCoda.filter((p) => p.stato === "in_coda");
        const inErrore = pecInCoda.filter((p) => p.stato === "errore");
        const attesaOre = daSpedire.length
          ? Math.floor((Date.now() - new Date(daSpedire[0].creato_at).getTime()) / 3_600_000)
          : 0;

        const righePec = [
          ...(daSpedire.length
            ? [
                daSpedire.length === 1
                  ? "C'è una PEC preparata dal gestionale e non ancora spedita."
                  : `Ci sono ${daSpedire.length} PEC preparate dal gestionale e non ancora spedite.`,
                `La più vecchia aspetta da ${attesaOre} ore.`,
                "",
                ...daSpedire
                  .slice(0, 15)
                  .map((p) => `  • ${p.oggetto} → ${(p.destinatari as string[]).join(", ")}`),
                "",
                "Le spedisce da sola l'attività sul computer (ogni 15 minuti). Se il computer è",
                "spento da un po', questa è la ragione per cui la coda non si è svuotata: si",
                "spedisce dal computer, dalla cartella del progetto, con",
                "  npm run pec -- --esegui",
                "",
                "Finché sono in coda, quei documenti non hanno data certa.",
              ]
            : []),
          ...(inErrore.length
            ? [
                "",
                inErrore.length === 1
                  ? "E c'è una PEC FERMA IN ERRORE (non riparte da sola): va letta."
                  : `E ci sono ${inErrore.length} PEC FERME IN ERRORE (non ripartono da sole): vanno lette.`,
                ...inErrore
                  .slice(0, 10)
                  .map((p) => `  • ${p.oggetto} — ${p.ultimo_errore ?? "motivo non registrato"}`),
                "Per riprovarne una, dopo aver capito il motivo:",
                "  npm run pec -- --esegui --id <id>",
              ]
            : []),
          "",
          "Messaggio generato automaticamente dal gestionale ToothTalk.",
          "",
        ];

        const { data: amministratoriPec } = await admin
          .from("profiles")
          .select("email")
          .eq("role", "admin")
          .eq("attivo", true);

        let recapitoPec = false;
        for (const a of amministratoriPec ?? []) {
          if (!a.email) continue;
          const inviata = await inviaEmailGmail({
            destinatario: a.email,
            oggetto:
              daSpedire.length > 0
                ? "[ToothTalk] PEC in coda da spedire"
                : "[ToothTalk] PEC ferma in errore",
            testo: righePec.join("\n"),
          });
          recapitoPec = recapitoPec || inviata;
        }

        await inviaPushAdmin({
          title: inErrore.length ? "PEC in errore" : "PEC in coda",
          body: inErrore.length
            ? `${inErrore.length} PEC ferme in errore: vanno lette.`
            : `${daSpedire.length} da spedire, la più vecchia da ${attesaOre} ore.`,
          url: "/admin",
        });

        return NextResponse.json({
          ok: true,
          eseguitoOra,
          esito: controllo.esito,
          avviso: recapitoPec,
          pecInCoda: daSpedire.length,
          pecInErrore: inErrore.length,
        });
      }

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
      ...(pecInCoda?.length
        ? [
            `E ci sono PEC che aspettano: ${pecInCoda.filter((p) => p.stato === "in_coda").length} da spedire, ${pecInCoda.filter((p) => p.stato === "errore").length} in errore.`,
            "Quei documenti non hanno ancora data certa. Si spediscono dal computer:",
            "  npm run pec -- --esegui",
            "",
          ]
        : []),
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
