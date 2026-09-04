import { NextResponse, type NextRequest } from "next/server";
import { richiestaAutorizzataCron } from "@/lib/api-auth";
import { generaRiepilogoGestionale } from "@/lib/gestionale/riepilogo";

export const dynamic = "force-dynamic";

const NOTION_VERSION = "2022-06-28";

type RichTextInput = { content: string; bold?: boolean; link?: string };

function testoNotion({ content, bold, link }: RichTextInput) {
  return {
    type: "text" as const,
    text: { content, ...(link ? { link: { url: link } } : {}) },
    ...(bold ? { annotations: { bold: true } } : {}),
  };
}

function paragrafoNotion(parti: RichTextInput[]) {
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: { rich_text: parti.map(testoNotion) },
  };
}

/**
 * Sostituisce il vecchio flusso "pull" (un task esterno chiamava
 * /api/briefing-gestionale ogni mattina): quel chiamante non riesce più a
 * raggiungerci per un blocco di rete lato suo, fuori dal nostro controllo.
 * Qui è il gestionale stesso a "spingere" il riepilogo su Notion, con un
 * cron interno di Vercel — non dipende più da chi lo tira.
 *
 * La pagina viene riscritta da zero a ogni esecuzione (elimina i blocchi
 * esistenti, poi ne scrive di nuovi) invece di cercare di modificare un
 * blocco specifico: più semplice e robusto, non si rompe se qualcuno tocca
 * la pagina a mano nel frattempo.
 */
export async function GET(request: NextRequest) {
  if (!richiestaAutorizzataCron(request)) {
    return NextResponse.json({ ok: false, errore: "non autorizzato" }, { status: 401 });
  }

  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_PAGE_ID;
  if (!token || !pageId) {
    return NextResponse.json(
      { ok: false, errore: "Notion non configurato (NOTION_TOKEN/NOTION_PAGE_ID)." },
      { status: 500 },
    );
  }

  const headersNotion = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  try {
    const riepilogo = await generaRiepilogoGestionale();
    const timestamp = new Date().toLocaleString("it-IT", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Rome",
    });

    // 1. Elenca i blocchi esistenti della pagina.
    const listRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
      headers: headersNotion,
    });
    if (!listRes.ok) {
      throw new Error(`Notion (list blocchi): ${listRes.status} ${await listRes.text()}`);
    }
    const { results: blocchiEsistenti } = (await listRes.json()) as { results: { id: string }[] };

    // 2. Elimina ogni blocco esistente.
    for (const blocco of blocchiEsistenti) {
      const delRes = await fetch(`https://api.notion.com/v1/blocks/${blocco.id}`, {
        method: "DELETE",
        headers: headersNotion,
      });
      if (!delRes.ok) {
        console.error(`Notion (delete blocco ${blocco.id}):`, delRes.status, await delRes.text());
      }
    }

    // 3. Riscrive il contenuto con i valori aggiornati.
    const appendRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: "PATCH",
      headers: headersNotion,
      body: JSON.stringify({
        children: [
          paragrafoNotion([
            {
              content:
                "Pagina scritta automaticamente da un cron job del progetto Vercel/Supabase del gestionale ToothTalk, non dal task briefing di Claude. Il task briefing la legge ogni mattina invece di chiamare l'endpoint esterno.",
            },
          ]),
          paragrafoNotion([
            { content: "riepilogo_testo: ", bold: true },
            { content: riepilogo.riepilogo_testo },
          ]),
          paragrafoNotion([
            { content: "link_gestionale: ", bold: true },
            { content: riepilogo.link_gestionale, link: riepilogo.link_gestionale || undefined },
          ]),
          paragrafoNotion([
            { content: "Ultimo aggiornamento: ", bold: true },
            { content: timestamp },
          ]),
        ],
      }),
    });
    if (!appendRes.ok) {
      throw new Error(`Notion (scrittura blocchi): ${appendRes.status} ${await appendRes.text()}`);
    }

    return NextResponse.json({ ok: true, generato_il: riepilogo.generato_il });
  } catch (e) {
    console.error("push-notion-briefing fallito:", e);
    return NextResponse.json({ ok: false, errore: String(e) }, { status: 500 });
  }
}
