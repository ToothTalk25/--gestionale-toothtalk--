"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

/**
 * Controlla un codice senza consumarlo, per mostrare a chi si sta
 * registrando in quale gruppo entrerà. Non rivela nulla se il codice è
 * sbagliato: solo "non riconosciuto".
 */
export async function verificaCodice(
  codice: string,
): Promise<Esito<{ gruppo: string }>> {
  if (!codice.trim()) return { ok: false, errore: "Inserisci il codice." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("verifica_invito", {
    p_codice: codice.trim(),
  });

  if (error) return { ok: false, errore: "Impossibile verificare il codice." };

  const riga = Array.isArray(data) ? data[0] : null;
  if (!riga?.valido) {
    return { ok: false, errore: riga?.motivo ?? "Codice non riconosciuto" };
  }

  return { ok: true, dati: { gruppo: riga.polo_nome } };
}

/**
 * Registrazione con codice di invito.
 *
 * Tutto avviene sul server: il codice viene verificato, l'account creato
 * con la chiave di servizio e l'assegnazione al gruppo fatta dal database.
 * Dal browser non si può né saltare la verifica né scegliersi il gruppo.
 *
 * Se l'assegnazione fallisce dopo la creazione dell'account, l'account
 * viene rimosso: meglio nessun utente che un utente orfano, senza gruppo,
 * che non capisce perché non vede niente.
 */
export async function registraConInvito(input: {
  nome: string;
  email: string;
  password: string;
  codice: string;
}): Promise<Esito<{ gruppo: string }>> {
  const nome = input.nome.trim();
  const email = input.email.trim().toLowerCase();
  const codice = input.codice.trim();

  if (!nome) return { ok: false, errore: "Inserisci nome e cognome." };
  if (!email) return { ok: false, errore: "Inserisci l'email." };
  if (input.password.length < 8) {
    return { ok: false, errore: "La password deve avere almeno 8 caratteri." };
  }

  const verifica = await verificaCodice(codice);
  if (!verifica.ok) return verifica;

  const admin = supabaseAdmin();

  const { data: creato, error: eCrea } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: nome },
  });

  if (eCrea || !creato?.user) {
    const msg = eCrea?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      return {
        ok: false,
        errore: "Esiste già un account con questa email. Prova ad accedere.",
      };
    }
    return { ok: false, errore: "Creazione account non riuscita." };
  }

  const { error: eInvito } = await admin.rpc("consuma_invito", {
    p_codice: codice,
    p_user: creato.user.id,
    p_email: email,
  });

  if (eInvito) {
    await admin.auth.admin.deleteUser(creato.user.id).catch(() => {});
    return {
      ok: false,
      errore: `Registrazione annullata: ${eInvito.message}`,
    };
  }

  return { ok: true, dati: { gruppo: verifica.dati.gruppo } };
}

// ------------------------------------------------- gestione dei codici

export async function creaCodiceInvito(
  poloId: string,
  maxUsi: number | null,
  scadeIl: string | null,
): Promise<Esito<{ codice: string }>> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return { ok: false, errore: "Operazione non disponibile da qui." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("crea_invito", {
    p_polo: poloId,
    p_max_usi: maxUsi,
    p_scade_il: scadeIl,
  });

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/admin");
  return { ok: true, dati: { codice: data as string } };
}

export async function disattivaCodiceInvito(invitoId: string): Promise<Esito> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return { ok: false, errore: "Operazione non disponibile da qui." };

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("inviti")
    .update({ attivo: false })
    .eq("id", invitoId);

  if (error) return { ok: false, errore: error.message };

  revalidatePath("/admin");
  return { ok: true, dati: undefined };
}
