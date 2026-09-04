import { createClient } from "@supabase/supabase-js";

export type RiepilogoGestionale = {
  generato_il: string;
  riepilogo_testo: string;
  da_sigillare: { gruppo: string; progetto: string; richieste_aperte: number }[];
  pec_da_inviare: { gruppo: string; progetto: string }[];
  richieste_modifica_aperte: { gruppo: string; progetto: string; stato: string }[];
  totali: {
    in_revisione: number;
    sigillati: number;
    pec_errore: number;
    richieste_aperte: number;
  };
  link_gestionale: string;
};

/**
 * Stato operativo del gestionale: da sigillare, PEC da inviare, richieste di
 * modifica aperte, totali. Logica invariata, estratta da
 * /api/briefing-gestionale (che continua a esporla via GET pubblico) perché
 * ora la richiama anche /api/cron/push-notion-briefing — una sola fonte,
 * niente copie a mano di query che toccano consensi GDPR e stati di sigillo.
 */
export async function generaRiepilogoGestionale(): Promise<RiepilogoGestionale> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: daSigillare } = await admin
    .from("v_video_da_rivedere")
    .select("gruppo, progetto, richieste_aperte")
    .eq("stato", "pronto")
    .order("gruppo");

  const { data: pecDaInviare } = await admin
    .from("v_video_da_rivedere")
    .select("gruppo, progetto")
    .eq("stato", "sigillato")
    .order("gruppo");

  const { data: richiesteModifica } = await admin
    .from("richieste_modifica")
    .select("stato, creata_at, titolo: tasks!inner(titolo), gruppo: tasks!inner(poli!inner(nome))")
    .in("stato", ["aperta", "da_verificare"])
    .order("creata_at");

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

  const daSigillareLista = daSigillare ?? [];
  const pecLista = pecDaInviare ?? [];
  const modLista = (richiesteModifica ?? []).map((r: any) => ({
    gruppo: r.gruppo?.poli?.nome ?? "—",
    progetto: r.titolo?.titolo ?? "—",
    stato: r.stato,
  }));

  const righe: string[] = [];
  const tuttoVuoto =
    daSigillareLista.length === 0 && pecLista.length === 0 && modLista.length === 0;

  if (tuttoVuoto) {
    righe.push("Nessun progetto in attesa.");
  } else {
    if (daSigillareLista.length > 0) {
      righe.push("Da sigillare:");
      for (const p of daSigillareLista) {
        const extra = p.richieste_aperte > 0 ? ` (${p.richieste_aperte} richieste aperte)` : "";
        righe.push(`- ${p.gruppo} — ${p.progetto}${extra}`);
      }
    }
    if (pecLista.length > 0) {
      righe.push("PEC da inviare:");
      for (const p of pecLista) {
        righe.push(`- ${p.gruppo} — ${p.progetto}`);
      }
    }
    if (modLista.length > 0) {
      righe.push("Richieste di modifica aperte:");
      for (const r of modLista) {
        const stato = r.stato === "da_verificare" ? "da verificare" : r.stato;
        righe.push(`- ${r.gruppo} — ${r.progetto} (${stato})`);
      }
    }
  }
  righe.push(
    `Totale: ${inRevisione ?? 0} in revisione · ${sigillati ?? 0} sigillati · ${pecErrore ?? 0} PEC in errore · ${richiesteAperteCount ?? 0} richieste aperte`,
  );

  return {
    generato_il: new Date().toISOString(),
    riepilogo_testo: righe.join("\n"),
    da_sigillare: daSigillareLista,
    pec_da_inviare: pecLista,
    richieste_modifica_aperte: modLista,
    totali: {
      in_revisione: inRevisione ?? 0,
      sigillati: sigillati ?? 0,
      pec_errore: pecErrore ?? 0,
      richieste_aperte: richiesteAperteCount ?? 0,
    },
    link_gestionale: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };
}
