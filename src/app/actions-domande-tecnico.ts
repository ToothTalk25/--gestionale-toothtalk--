"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

type Esito = { ok: true } | { ok: false; errore: string };

/**
 * Il Collaboratore Tecnico risponde a una domanda tecnica. La risposta arriva
 * DIRETTAMENTE al partecipante che l'ha scritta (decisione del 16/09/2026:
 * niente più passaggio dal Coordinatore).
 *
 * Doppio controllo, come vuole il progetto: qui lato server sul ruolo, e
 * comunque nella RLS (0134) — il ruolo 'tecnico' può scrivere solo risposta,
 * risposto_da e risposto_at, e solo su una riga categoria_ia = 'tecnica'; un
 * trigger blocca qualunque altra modifica alla riga.
 */
export async function rispondiDomandaTecnica(id: string, testoGrezzo: string): Promise<Esito> {
  const ctx = await requireSession();
  if (ctx.profile.role !== "tecnico" && !ctx.isAdmin) {
    return { ok: false, errore: "Solo il Collaboratore Tecnico (o l'accesso globale) può rispondere qui." };
  }

  const testo = testoGrezzo.trim();
  if (!testo) return { ok: false, errore: "Scrivi una risposta prima di inviare." };
  if (testo.length > 4000) return { ok: false, errore: "Risposta troppo lunga (massimo 4000 caratteri)." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("domande_supporto")
    .update({
      risposta: testo,
      risposto_da: ctx.profile.id,
      risposto_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("categoria_ia", "tecnica");
  if (error) return { ok: false, errore: `Invio fallito: ${error.message}` };

  revalidatePath("/tecnico");
  return { ok: true };
}
