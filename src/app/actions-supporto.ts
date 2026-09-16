"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { classificaDomandaSupporto } from "@/lib/gemini";
import { inviaPushAdmin } from "@/lib/push";
import { inviaEmailGmail } from "@/lib/mail";

type Esito = { ok: true } | { ok: false; errore: string };

function errore(msg: string): Esito {
  return { ok: false, errore: msg };
}

export type RigaDomandaSupporto = {
  id: string;
  user_id: string;
  domanda: string;
  creato_at: string;
  categoria_ia: "tecnica" | "altro" | null;
  bozza_risposta_ia: string | null;
  richiede_coordinatore: boolean;
  risposta: string | null;
  risposto_da: string | null;
  risposto_at: string | null;
};

const COLONNE_DOMANDA =
  "id, user_id, domanda, creato_at, categoria_ia, bozza_risposta_ia, richiede_coordinatore, risposta, risposto_da, risposto_at";

/** Scrive una nuova domanda (qualsiasi collaboratore). Avvia in background classificazione IA e, se serve, notifica push al Coordinatore. */
export async function inviaDomanda(testoGrezzo: string): Promise<Esito> {
  const ctx = await requireSession();
  const domanda = testoGrezzo.trim();
  if (!domanda) return errore("Scrivi una domanda prima di inviare.");
  if (domanda.length > 4000) return errore("Domanda troppo lunga (massimo 4000 caratteri).");

  const supabase = await supabaseServer();
  const { data: riga, error: eInsert } = await supabase
    .from("domande_supporto")
    .insert({ user_id: ctx.profile.id, domanda })
    .select("id")
    .single<{ id: string }>();
  if (eInsert || !riga) return errore("Invio fallito, riprova.");

  // Classificazione IA e notifica: dopo aver risposto al client, non prima —
  // after() tiene viva la funzione serverless finché non finisce, a
  // differenza di un fire-and-forget semplice che su Vercel viene interrotto
  // appena la risposta parte (stesso problema già risolto per il
  // riconoscimento IA dei video in collegaElemento).
  after(async () => {
    await arricchisciEDinotifica(riga.id, domanda, ctx.profile.full_name ?? ctx.profile.email).catch((e) => {
      console.error("Arricchimento/notifica domanda supporto fallita:", e);
    });
  });

  return { ok: true };
}

async function arricchisciEDinotifica(id: string, domanda: string, nomeMittente: string): Promise<void> {
  const admin = supabaseAdmin();

  const esito = await classificaDomandaSupporto(domanda);

  if (esito.categoria === "tecnica") {
    // Le domande tecniche non ricevono più una risposta autonoma dell'IA:
    // vanno al Collaboratore Tecnico via email, non a rispondere lui
    // stesso nel gestionale (rispondiDomanda resta admin-only — allargare
    // quel permesso a una persona esterna contraddirebbe il perimetro di
    // accesso minimo scritto nel Documento 5, Art. 4). Chi risponde nel
    // gestionale resta sempre e solo l'accesso globale, incollando la
    // risposta ricevuta dal Collaboratore Tecnico.
    await admin
      .from("domande_supporto")
      .update({
        categoria_ia: "tecnica",
        bozza_risposta_ia: null,
        bozza_generata_at: new Date().toISOString(),
      })
      .eq("id", id);

    await inoltraDomandaTecnica(domanda, nomeMittente);
    return;
  }

  await admin
    .from("domande_supporto")
    .update({
      categoria_ia: esito.categoria,
      bozza_risposta_ia: esito.bozza,
      bozza_generata_at: new Date().toISOString(),
    })
    .eq("id", id);

  await inviaPushAdmin({
    title: "Nuova domanda — ToothTalk",
    body: `${nomeMittente}: ${domanda.slice(0, 120)}${domanda.length > 120 ? "…" : ""}`,
    url: "/admin",
  });
}

/**
 * Inoltra una domanda tecnica ai Collaboratori Tecnici attivi, via email —
 * solo nome di battesimo di chi ha chiesto (Documento 5, Art. 8.2:
 * minimizzazione, il cognome non serve mai a rispondere a una domanda
 * tecnica). Se non c'è ancora nessun Collaboratore Tecnico configurato in
 * /admin/tecnico, la domanda resta comunque visibile in admin per
 * trasparenza — solo senza nessuno a cui inoltrarla.
 */
async function inoltraDomandaTecnica(domanda: string, nomeMittente: string): Promise<void> {
  const admin = supabaseAdmin();
  const { data: tecnici } = await admin
    .from("collaboratori_tecnici")
    .select("contatto")
    .eq("attivo", true)
    .returns<{ contatto: string }[]>();
  if (!tecnici?.length) return;

  const primoNome = nomeMittente.split(" ")[0];
  const testo = [
    "Ciao,",
    "",
    `${primoNome} ha fatto questa domanda tecnica nel gestionale ToothTalk:`,
    "",
    `"${domanda}"`,
    "",
    "Rispondi a Enrico (non a questa email): la incollerà lui nel gestionale,",
    "così resta lui l'ultimo controllo su cosa arriva ufficialmente al",
    "Collaboratore che ha chiesto.",
    "",
    "Messaggio generato automaticamente dal gestionale ToothTalk.",
  ].join("\n");

  await Promise.all(
    tecnici.map((t) =>
      inviaEmailGmail({
        destinatario: t.contatto,
        oggetto: "[ToothTalk] Domanda tecnica dal supporto",
        testo,
      }),
    ),
  );
}

/** Le proprie domande (widget chat), più recenti per ultime. */
export async function elencaMieDomande(): Promise<RigaDomandaSupporto[]> {
  const ctx = await requireSession();
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("domande_supporto")
    .select(COLONNE_DOMANDA)
    .eq("user_id", ctx.profile.id)
    .order("creato_at", { ascending: true })
    .returns<RigaDomandaSupporto[]>();
  return data ?? [];
}

/** Il collaboratore chiede esplicitamente di parlare col Coordinatore (anche dopo una risposta IA). */
export async function richiediCoordinatore(id: string): Promise<Esito> {
  const ctx = await requireSession();
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("richiedi_coordinatore_domanda", { p_id: id });
  if (error) return errore(error.message);

  after(async () => {
    await inviaPushAdmin({
      title: "Un partecipante chiede di te — ToothTalk",
      body: `${ctx.profile.full_name ?? ctx.profile.email} vuole parlare con te nella sezione Domande.`,
      url: "/admin",
    }).catch((e) => console.error("Notifica richiediCoordinatore fallita:", e));
  });

  revalidatePath("/admin");
  return { ok: true };
}

/** Risponde a una domanda (solo Coordinatore). testoGrezzo può essere la bozza IA rivista o una risposta scritta da zero. */
export async function rispondiDomanda(id: string, testoGrezzo: string): Promise<Esito> {
  const ctx = await requireSession();
  if (!ctx.isAdmin) return errore("Operazione riservata all'accesso globale.");

  const risposta = testoGrezzo.trim();
  if (!risposta) return errore("Scrivi una risposta prima di inviare.");

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("domande_supporto")
    .update({ risposta, risposto_da: ctx.profile.id, risposto_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return errore(error.message);

  revalidatePath("/admin");
  return { ok: true };
}

/** Registra l'iscrizione push di questo dispositivo (qualsiasi utente loggato). */
export async function registraPush(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<Esito> {
  const ctx = await requireSession();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: ctx.profile.id,
      endpoint: sub.endpoint,
      chiave_p256dh: sub.keys.p256dh,
      chiave_auth: sub.keys.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) return errore(error.message);
  return { ok: true };
}

/** Rimuove l'iscrizione push di questo dispositivo. */
export async function rimuoviPush(endpoint: string): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return errore(error.message);
  return { ok: true };
}
