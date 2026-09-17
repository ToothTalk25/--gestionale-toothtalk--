import type { Profile } from "@/lib/types";

/**
 * Le regole dell'Accordo editoriale, in un solo posto: le usano sia il server
 * (blocco del layout e destinazione dopo il login, da src/lib/auth.ts) sia il
 * profilo (la checklist che il Collaboratore vede). Tenerle qui significa che
 * non possono più divergere: prima erano scritte in due punti.
 */

/**
 * Momento in cui la controfirma del Titolare è entrata in vigore (migrazione
 * 0118, 7 settembre 2026). Serve a distinguere DUE casi che si somigliano:
 *
 *  - chi è stato approvato PRIMA di quella data: la controfirma non è mai
 *    stata chiesta, non va inventata una conferma mai data → non serve;
 *  - chi è stato approvato DOPO: la controfirma è parte del percorso, e finché
 *    non è caricata e confermata l'accesso ai progetti NON si apre.
 *
 * La differenza conta: senza la data, il secondo caso veniva trattato come il
 * primo — cioè chiunque veniva fatto entrare nei progetti nell'intervallo fra
 * l'approvazione dell'accordo e il caricamento della controfirma.
 */
export const CONTROFIRMA_OBBLIGATORIA_DAL = new Date("2026-09-07T19:16:49+02:00").getTime();

/**
 * I campi del profilo che servono a decidere se l'accordo è completo: un
 * sottoinsieme di Profile, così la stessa regola vale per il profilo intero
 * (Server Component) e per la riga scarna letta dal middleware.
 */
export type ProfiloAccordo = Pick<
  Profile,
  | "accordo_path"
  | "accordo_letto_confermato"
  | "accordo_verificato"
  | "accordo_approvato_admin_at"
  | "accordo_controfirmato_path"
  | "accordo_controfirma_confermata_at"
>;

/** True solo se la controfirma del Titolare non è mai stata richiesta a questo profilo. */
export function controfirmaNonRichiesta(profile: ProfiloAccordo): boolean {
  if (!profile.accordo_approvato_admin_at || profile.accordo_controfirmato_path) return false;
  return new Date(profile.accordo_approvato_admin_at).getTime() < CONTROFIRMA_OBBLIGATORIA_DAL;
}

/**
 * Le cinque condizioni che sbloccano l'accesso ai progetti: accordo caricato,
 * "ho letto e compreso" confermato, verifica superata, approvazione del
 * Titolare, controfirma caricata E confermata dal Collaboratore (o mai
 * richiesta, per chi era già approvato prima della 0118).
 */
export function accordoCompleto(profile: ProfiloAccordo, isAdmin: boolean): boolean {
  return (
    isAdmin ||
    (!!profile.accordo_path &&
      profile.accordo_letto_confermato &&
      profile.accordo_verificato === "ok" &&
      !!profile.accordo_approvato_admin_at &&
      (!!profile.accordo_controfirma_confermata_at || controfirmaNonRichiesta(profile)))
  );
}

/**
 * L'Accordo (Art. 9.1) ha durata fissa di 6 mesi: la scadenza è "passata"
 * quando è OGGI + 1 giorno — il giorno di scadenza appartiene ancora al
 * periodo, la sospensione parte il giorno dopo. È qui (e non in auth.ts)
 * perché la usa anche il middleware, che non può importare moduli server.
 */
export function accordoScaduto(scadenza: string | null, oggi = new Date()): boolean {
  if (!scadenza) return false;
  const fine = new Date(`${scadenza}T23:59:59`);
  return oggi > fine;
}
