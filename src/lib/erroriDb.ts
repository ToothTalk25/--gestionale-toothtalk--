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
  // Il profilo ha ancora una richiesta aperta (GDPR o ricarica dichiarazione)
  // che lo referenzia: il vincolo blocca la cancellazione finché non è chiusa
  // dalla coda giusta. Elencare le tabelle qui invece di controllarle prima
  // con una query per ciascuna: il database resta l'unica fonte di verità
  // aggiornata su quali tabelle referenziano il profilo.
  if (
    m.includes("foreign key constraint") &&
    (m.includes("richieste_eliminazione_grezzo") ||
      m.includes("richieste_rimozione_pubblicato") ||
      m.includes("notifiche_dovute_art82") ||
      m.includes("richieste_ricaricamento_dichiarazione"))
  ) {
    return "Ci sono richieste aperte (GDPR o ricarica dichiarazione) collegate a questo profilo: risolvile dalle rispettive code prima di eliminare l'account.";
  }
  if (m.includes("row-level security") || m.includes("permission denied")) {
    // A differenza dei casi sopra (previsti e normali), un rifiuto RLS/permessi
    // non dovrebbe mai capitare qui dentro (chi chiama è già filtrato per
    // ruolo più a monte): se scatta è un bug da poter rintracciare nei log,
    // non solo un caso da spiegare genericamente all'utente.
    console.error("traduciErroreDb: RLS/permesso negato inatteso:", messaggio);
    return "Operazione non consentita per il tuo ruolo: se pensi sia un errore, contattami.";
  }
  // Fallback: un vincolo di chiave esterna non ancora elencato sopra (es. una
  // tabella aggiunta in futuro) dà comunque un messaggio leggibile invece del
  // testo grezzo di Postgres.
  if (m.includes("foreign key constraint")) {
    return "Ci sono dati collegati a questo profilo che ne impediscono l'eliminazione.";
  }
  return messaggio;
}
