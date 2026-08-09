"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { AmbitoRichiesta } from "@/lib/types";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

/**
 * Richieste di correzione su un video già sigillato.
 *
 * Non toccano il pacchetto — quello resta immutabile, ed è il motivo per cui
 * ha valore. Sono comunicazioni tracciate che restano dentro la piattaforma
 * invece di disperdersi nelle chat.
 */
export async function apriRichiesta(
  taskId: string,
  pacchettoId: string | null,
  ambito: AmbitoRichiesta,
  testo: string,
): Promise<Esito> {
  const { profile, isAdmin } = await requireSession();
  if (!isAdmin) return { ok: false, errore: "Operazione non disponibile da qui." };
  if (!testo.trim()) return { ok: false, errore: "Scrivi cosa va corretto." };

  const supabase = await supabaseServer();
  const { error } = await supabase.from("richieste_modifica").insert({
    task_id: taskId,
    pacchetto_id: pacchettoId,
    ambito,
    testo: testo.trim(),
    creata_da: profile.id,
  });

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/revisione");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/** Segna una richiesta come risolta: la chiude chi corregge o chi l'ha aperta. */
export async function chiudiRichiesta(
  taskId: string,
  richiestaId: string,
  nota?: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase
    .from("richieste_modifica")
    .update({ stato: "risolta", nota_risposta: nota?.trim() || null })
    .eq("id", richiestaId);

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/revisione");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}
