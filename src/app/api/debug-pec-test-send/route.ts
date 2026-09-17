import { NextResponse } from "next/server";
import { leggiConfigPec, spedisciPec } from "@/lib/pec";

// TEMPORANEO: verifica reale se il blocco IP Aruba (ticket 19039798A) è
// ancora attivo dopo l'aggiornamento del 17/09 ore 10:10 ("procedura
// risolutiva effettuata"). Da eliminare subito dopo la verifica.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== "tt-debug-2026-09-17") {
    return NextResponse.json({ ok: false, errore: "non autorizzato" }, { status: 401 });
  }
  try {
    const config = leggiConfigPec();
    const { messageId, accettato } = await spedisciPec({
      config,
      oggetto: "[ToothTalk] Test invio — verifica blocco Aruba",
      testo: "Test automatico per verificare se il blocco IP e stato risolto.",
      html: "<p>Test automatico per verificare se il blocco IP e stato risolto.</p>",
      allegati: [],
    });
    return NextResponse.json({ ok: true, messageId, accettato });
  } catch (e) {
    return NextResponse.json(
      { ok: false, errore: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
