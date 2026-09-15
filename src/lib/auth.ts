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
      "id, email, pec, full_name, role, attivo, on_screen, universita, foto_path, data_nascita, luogo_nascita, codice_fiscale, accordo_path, accordo_sha256, accordo_caricato_at, accordo_verificato, accordo_verifica_note, accordo_verificato_at, accordo_letto_confermato, accordo_approvato_admin_at, accordo_approvato_da, accordo_scadenza, accordo_controfirmato_path, accordo_controfirmato_sha256, accordo_controfirmato_caricato_at, accordo_controfirma_confermata_at, rinnovo_path, rinnovo_sha256, rinnovo_caricato_at, rinnovo_approvato_admin_at, rinnovo_approvato_da, nomina_path, nomina_sha256, nomina_generata_at, cancellazione_copie_richiesta_at, cancellazione_copie_confermata_at",
    )
    .eq("id", session.user.id)
    .single<Profile>();

  if (!profile) return null;

  // Uscita con conferma Art. 9.4 pendente: l'account è disattivato ma il
  // Collaboratore può ancora entrare nella pagina dedicata per confermare
  // di aver cancellato le copie locali (unico scopo dell'accesso). Ogni
  // altra pagina lo rimanda lì (vedi layout) e la conferma lo scollega.
  const soloConfermaUscita =
    !profile.attivo &&
    !!profile.cancellazione_copie_richiesta_at &&
    !profile.cancellazione_copie_confermata_at;
  if (!profile.attivo && !soloConfermaUscita) return null;

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
    soloConfermaUscita,
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

/**
 * Le cinque condizioni che sbloccano l'accesso ai progetti — stessa logica
 * usata dal layout del gruppo (app) per decidere il redirect verso
 * /profilo, estratta qui così anche il login (destinazioneIngresso sotto)
 * la applica senza duplicarla.
 */
export function accordoCompleto(profile: Profile, isAdmin: boolean): boolean {
  // Franchigia per chi era già approvato PRIMA che la controfirma
  // esistesse: vedi il commento gemello nel layout del gruppo (app).
  const controfirmaNonRichiestaPerApprovazionePregressa =
    !!profile.accordo_approvato_admin_at && !profile.accordo_controfirmato_path;
  return (
    isAdmin ||
    (!!profile.accordo_path &&
      profile.accordo_letto_confermato &&
      profile.accordo_verificato === "ok" &&
      !!profile.accordo_approvato_admin_at &&
      (!!profile.accordo_controfirma_confermata_at || controfirmaNonRichiestaPerApprovazionePregressa))
  );
}

/**
 * Dove deve atterrare un utente appena autenticato, applicando nello stesso
 * ordine le regole di redirect del layout (app): usata dal login per andare
 * dritti alla destinazione giusta invece di passare da /dashboard e farsi
 * rimandare indietro dal layout — un redirect server-side innescato a metà
 * di una transizione client (router.replace) mandava il router di Next.js
 * 16 in un loop di richieste continue in produzione, riscontrato end-to-end
 * con un account appena approvato ma senza accordo ancora caricato.
 */
export function destinazioneIngresso(ctx: SessionContext): string {
  if (ctx.soloConfermaUscita) return "/uscita";
  if (!accordoCompleto(ctx.profile, ctx.isAdmin)) return "/profilo";
  if (!ctx.isAdmin && accordoScaduto(ctx.profile.accordo_scadenza)) return "/rinnovo";
  return "/dashboard";
}

/**
 * L'Accordo (Art. 9.1) ha durata fissa di 6 mesi: la scadenza (accordo_scadenza,
 * una data) è "passata" quando è OGGI + 1 giorno — il giorno di scadenza
 * appartiene ancora al periodo, la sospensione parte il giorno dopo. Stessa
 * funzione usata dal layout e dalla pagina /rinnovo, così il blocco e lo
 * sblocco non possono mai divergere.
 */
export function accordoScaduto(scadenza: string | null, oggi = new Date()): boolean {
  if (!scadenza) return false;
  const fine = new Date(`${scadenza}T23:59:59`);
  return oggi > fine;
}
