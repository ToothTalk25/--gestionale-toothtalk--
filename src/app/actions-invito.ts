"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth";
import { inviaPushAdmin } from "@/lib/push";
import { COOKIE_VERSION, PRIVACY_VERSION } from "@/lib/types";

type Esito<T = void> = { ok: true; dati: T } | { ok: false; errore: string };

/**
 * Controlla un codice senza consumarlo, per mostrare a chi si sta
 * registrando in quale gruppo entrerà. Non rivela nulla se il codice è
 * sbagliato: solo "non riconosciuto".
 */
export async function verificaCodice(
  codice: string,
): Promise<Esito<{ gruppo: string; polo_id: string }>> {
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

  return {
    ok: true,
    dati: { gruppo: riga.polo_nome, polo_id: riga.polo_id as string },
  };
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
  pec: string;
  password: string;
  codice: string;
  onScreen: boolean | null;
  consenso: boolean;
}): Promise<Esito<{ gruppo: string }>> {
  const nome = input.nome.trim();
  const email = input.email.trim().toLowerCase();
  const pec = input.pec.trim().toLowerCase();
  const codice = input.codice.trim();

  if (!nome) return { ok: false, errore: "Inserisci nome e cognome." };
  if (!email) return { ok: false, errore: "Inserisci l'email." };
  // La PEC è facoltativa: se presente deve essere un indirizzo valido
  // (qualunque dominio, incluse email normali). L'email di accesso resta
  // comunque il canale minimo garantito.
  if (pec && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pec)) {
    return { ok: false, errore: "Inserisci un indirizzo email valido (o lascia vuoto)." };
  }
  if (input.password.length < 8) {
    return { ok: false, errore: "La password deve avere almeno 8 caratteri." };
  }
  if (input.onScreen === null) {
    return {
      ok: false,
      errore: "Indica se apparirai nei video (in video o dietro le quinte).",
    };
  }
  if (!input.consenso) {
    return {
      ok: false,
      errore: "Per registrarti devi accettare l'informativa privacy e la cookie policy.",
    };
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

  // La PEC (facoltativa) e il tipo di partecipante (appare in video o no),
  // registrati subito nel profilo. Se la PEC è vuota si salva null: non è
  // più richiesta per partecipare. Il tipo determina il flag on_screen
  // (usato solo per la revoca GDPR). L'account nasce INATTIVO: la persona
  // non può accedere finché l'Admin non la approva (getSessionContext
  // tratta attivo=false come nessuna sessione). L'approvazione la fa
  // approvaRegistrazione.
  try {
    await admin
      .from("profiles")
      .update({ pec: pec || null, on_screen: input.onScreen, attivo: false })
      .eq("id", creato.user.id);
  } catch {
    // Non blocchiamo la creazione: la PEC e il tipo si possono completare dal profilo.
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

  // Consenso GDPR dimostrabile: chi, quando, quale versione.
  try {
    await admin.from("consensi").insert([
      { user_id: creato.user.id, tipo: "privacy", versione: PRIVACY_VERSION },
      { user_id: creato.user.id, tipo: "cookie", versione: COOKIE_VERSION },
    ]);
  } catch {
    // Se la registrazione del consenso fallisce non blocchiamo l'account:
    // il banner chiederà il consenso al primo accesso.
  }

  // Avviso immediato all'accesso globale: c'è una richiesta di registrazione
  // da approvare. L'account nasce inattivo, quindi finché non si approva dal
  // pannello quella persona non può entrare: senza questo avviso la richiesta
  // resta invisibile finché non si apre /admin per caso.
  await inviaPushAdmin({
    title: "Nuova richiesta di registrazione — ToothTalk",
    body: `${nome} chiede di entrare nel gruppo ${verifica.dati.gruppo}.`,
    url: "/admin",
  });

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

/**
 * Cambia limite di utilizzi e scadenza del codice ATTIVO di un gruppo, senza
 * rigenerarlo: il codice già mandato per email (o condiviso a voce) continua a
 * valere, quindi chi lo ha ricevuto non resta con un codice disattivato.
 *
 * Serve perché il limite scritto nella sezione Inviti vale solo nel momento in
 * cui il codice nasce: su un codice già in giro non si poteva più intervenire.
 * Il numero di utilizzi già fatti resta: non si può scendere sotto quello.
 */
export async function aggiornaLimiteInvito(
  invitoId: string,
  opzioni: { maxUsi: number | null; scadeIl: string | null },
): Promise<Esito<{ codice: string; usi: number; maxUsi: number | null }>> {
  const { isAdmin } = await requireSession();
  if (!isAdmin) return { ok: false, errore: "Operazione non disponibile da qui." };

  if (opzioni.maxUsi !== null && (!Number.isInteger(opzioni.maxUsi) || opzioni.maxUsi < 1)) {
    return {
      ok: false,
      errore: "Il limite deve essere un numero intero di almeno 1 — oppure vuoto, per utilizzi illimitati.",
    };
  }

  const supabase = await supabaseServer();
  const { data: invito } = await supabase
    .from("inviti")
    .select("id, codice, usi")
    .eq("id", invitoId)
    .maybeSingle<{ id: string; codice: string; usi: number }>();
  if (!invito) return { ok: false, errore: "Codice non trovato." };
  if (opzioni.maxUsi !== null && opzioni.maxUsi < invito.usi) {
    return {
      ok: false,
      errore: `Il codice è già stato usato ${invito.usi} ${invito.usi === 1 ? "volta" : "volte"}: il limite non può essere più basso.`,
    };
  }

  // La scadenza è "fine giornata" del giorno scelto: come per l'accordo, il
  // giorno indicato è ancora valido.
  const scade = opzioni.scadeIl ? new Date(`${opzioni.scadeIl}T23:59:59`).toISOString() : null;

  const { error } = await supabase
    .from("inviti")
    .update({ max_usi: opzioni.maxUsi, scade_il: scade })
    .eq("id", invitoId);
  if (error) return { ok: false, errore: error.message };

  revalidatePath("/admin");
  return { ok: true, dati: { codice: invito.codice, usi: invito.usi, maxUsi: opzioni.maxUsi } };
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
