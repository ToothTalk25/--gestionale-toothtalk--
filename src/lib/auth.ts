import { redirect } from "next/navigation";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import type { Polo, Profile, SessionContext } from "@/lib/types";

/** Genova è il gruppo storico del progetto: compare sempre per primo nelle liste. */
export function ordinaPoli(poli: Polo[]): Polo[] {
  return [...poli].sort((a, b) => {
    if (a.nome === "Genova") return -1;
    if (b.nome === "Genova") return 1;
    return 0;
  });
}

/**
 * Risolve utente + ruolo + poli di appartenenza.
 * È l'unico punto in cui l'app decide "chi sei"; le autorizzazioni vere
 * restano comunque nel database (RLS), questo serve solo a disegnare la UI.
 *
 * Avvolta in React cache(): se layout e pagina la chiamano entrambi nello
 * stesso render, getUser() (che fa una chiamata HTTP a Supabase) parte una
 * sola volta, non una per componente. È la differenza fra 3 e 1 chiamata
 * di rete per ogni navigazione.
 */
export const getSessionContext = cache(async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await supabaseServer();

  // getSession() legge il JWT locale (istantaneo): l'id utente è già nel
  // token, niente chiamata HTTP a Supabase. La validazione reale resta
  // comunque nella RLS su ogni query e nel check profile.attivo qui sotto:
  // un token revocato o un profilo disattivato non passa.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, email, pec, full_name, role, attivo, on_screen, universita, foto_path, accordo_path, accordo_sha256, accordo_caricato_at, accordo_verificato, accordo_verifica_note, accordo_verificato_at",
    )
    .eq("id", session.user.id)
    .single<Profile>();

  if (!profile || !profile.attivo) return null;

  // L'Admin vede tutti i poli, il membro solo i propri: la select è la stessa,
  // è la RLS su "poli" a filtrare.
  const { data: poli } = await supabase
    .from("poli")
    .select("id, nome, slug, citta, attivo")
    .eq("attivo", true)
    .order("nome")
    .returns<Polo[]>();

  return {
    profile,
    poli: ordinaPoli(poli ?? []),
    isAdmin: profile.role === "admin",
  };
});

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireAdmin(): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!ctx.isAdmin) redirect("/dashboard");
  return ctx;
}
