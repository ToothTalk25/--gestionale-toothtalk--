/**
 * Traduce le classi di errore Postgres grezze e non parlanti in un
 * messaggio in italiano generico. Gli errori sollevati apposta dai
 * trigger applicativi (es. "Video completo già sigillato...") arrivano
 * già in italiano e leggibili: quelli passano invariati.
 */
export function traduciErroreDb(messaggio: string): string {
  const m = messaggio.toLowerCase();
  if (m.includes("row-level security") || m.includes("violates") || m.includes("permission denied")) {
    return "Operazione non consentita dal tuo ruolo.";
  }
  return messaggio;
}
