/**
 * Traduce le classi di errore Postgres grezze e non parlanti in un
 * messaggio in italiano generico. Gli errori sollevati apposta dai
 * trigger applicativi (es. "Video completo già sigillato...") arrivano
 * già in italiano e leggibili: quelli passano invariati.
 */
export function traduciErroreDb(messaggio: string): string {
  const m = messaggio.toLowerCase();
  // Vincolo di chiave esterna: il file è ancora agganciato a un elemento
  // del Video completo. Non è un problema di permessi — va detto diverso,
  // altrimenti sembra un rifiuto arbitrario invece che una conseguenza
  // logica ("prima sgancialo, poi elimina").
  if (m.includes("foreign key constraint") && m.includes("pacchetto_elementi")) {
    return "Questo file fa parte del Video completo: rimuovilo prima da lì, poi potrai eliminarlo qui.";
  }
  if (m.includes("row-level security") || m.includes("permission denied") || m.includes("violates")) {
    return "Operazione non consentita dal tuo ruolo.";
  }
  return messaggio;
}
