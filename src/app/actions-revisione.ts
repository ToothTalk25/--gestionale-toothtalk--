"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import type { AmbitoRichiesta } from "@/lib/types";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

/**
 * Richieste di correzione PRIMA del sigillo: chi ha accesso globale segnala
 * cosa va corretto mentre revisiona un pacchetto "pronto". Su un pacchetto
 * già sigillato non si può aprire (va annullato, non corretto qui) — e
 * aprirne una su un pacchetto "pronto" lo rimanda automaticamente in
 * composizione, così il gruppo la vede e può intervenire subito.
 */
export async function apriRichiesta(
  taskId: string,
  pacchettoId: string | null,
  ambito: AmbitoRichiesta,
  testo: string,
): Promise<Esito> {
  await requireSession();
  if (!testo.trim()) return { ok: false, errore: "Scrivi cosa va corretto." };

  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("apri_richiesta_modifica", {
    p_task: taskId,
    p_pacchetto: pacchettoId,
    p_ambito: ambito,
    p_testo: testo.trim(),
  });

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/revisione");
  revalidatePath(`/polo/[poloId]`, "page");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/**
 * Chi corregge segnala di aver fatto. Se lo clicca il gruppo, la richiesta
 * passa a "da verificare": resta a chi l'ha aperta (l'admin) confermarla o
 * riaprirla. Se la chiude direttamente l'admin, si risolve subito — non
 * deve confermare a se stesso.
 */
export async function segnaFatta(
  taskId: string,
  richiestaId: string,
  nota?: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("segna_richiesta_fatta", {
    p_richiesta: richiestaId,
    p_nota: nota?.trim() || null,
  });

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/revisione");
  revalidatePath(`/polo/[poloId]`, "page");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}

/** L'admin conferma (o respinge) una correzione segnalata come fatta dal gruppo. */
export async function confermaRichiesta(
  taskId: string,
  richiestaId: string,
  ok: boolean,
  nota?: string,
): Promise<Esito> {
  await requireSession();
  const supabase = await supabaseServer();

  const { error } = await supabase.rpc("conferma_richiesta", {
    p_richiesta: richiestaId,
    p_ok: ok,
    p_nota: nota?.trim() || null,
  });

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/revisione");
  revalidatePath(`/polo/[poloId]`, "page");
  revalidatePath(`/task/${taskId}`);
  return { ok: true, dati: undefined };
}
