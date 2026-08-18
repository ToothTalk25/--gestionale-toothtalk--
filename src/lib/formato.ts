/**
 * Regole di forma uniformi per i testi del gestionale.
 *
 * Queste funzioni NON toccano il contenuto: si limitano a portare ogni
 * testo nella stessa forma, così che tutti i poli scrivano titoli,
 * descrizioni e script coerenti tra loro (e con i nomi dei file su Drive).
 *
 * Sono trasformazioni deterministiche (regex semplici, < 1ms, zero rete,
 * zero IA): lo stesso input produce sempre lo stesso output.
 */

/** Collassa spazi/righe vuote, rimuove spazi di inizio/fine riga. */
function pulisciSpazi(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n") // spazi/tab a fine riga
    .replace(/\n{3,}/g, "\n\n") // al massimo una riga vuota
    .trim();
}

/** Caratteri che rompono i nomi dei file su Drive/file system. */
export const CARATTERI_VIETATI = /[\\/:*<>|"]/g;

/** Collassa gli spazi multipli in uno solo (ma conserva gli a capo). */
function spaziSingoli(s: string): string {
  return s.replace(/[ \t]{2,}/g, " ");
}

/** Prima lettera maiuscola (gestisce anche le accentate). */
function maiuscolaIniziale(s: string): string {
  return s.length ? s.charAt(0).toLocaleUpperCase("it-IT") + s.slice(1) : s;
}

/** Toglie un eventuale punto finale (coerente coi nomi su Drive). */
function togliPuntoFinale(s: string): string {
  return s.replace(/\.\s*$/, "");
}

/**
 * Rimuove prefissi accidentali tipo "Video 5 - ...", "Video 5: ...",
 * "5. ..." o "5 - ..." scritti a mano dall'utente (evitano doppioni,
 * perché il numero viene gestito separatamente dal sistema).
 */
function togliPrefissoVideo(s: string): string {
  return s.replace(/^(video\s*\d+\s*[-–—:.]*\s*)/i, "").replace(/^(\d+\s*[-–—:.]+\s*)/, "");
}

/**
 * Titolo del video/progetto: una riga, maiuscola iniziale, senza punto
 * finale, senza caratteri vietati per i file, max 80 caratteri.
 */
export function normalizzaTitolo(input: string): string {
  let s = pulisciSpazi(input);
  s = spaziSingoli(s);
  s = s.replace(/\r/g, "").replace(/\n+/g, " "); // titolo: una sola riga
  s = togliPrefissoVideo(s);
  s = togliPuntoFinale(s);
  s = s.replace(CARATTERI_VIETATI, "").replace(/[ ]+/g, " ");
  s = maiuscolaIniziale(s);
  return s.slice(0, 80).trim();
}

/**
 * Titolo per YouTube Shorts: come il titolo ma max 100 caratteri e sempre
 * su una sola riga (già garantita da normalizzaTitolo).
 */
export function normalizzaTitoloYouTube(input: string): string {
  return normalizzaTitolo(input).slice(0, 100);
}

/** Descrizione (caption) da pubblicare: testo libero, forma pulita. */
export function normalizzaDescrizione(input: string): string {
  let s = pulisciSpazi(input);
  s = spaziSingoli(s);
  return s.slice(0, 5000).trim();
}

/** Script: testo libero, forma pulita. */
export function normalizzaScript(input: string): string {
  let s = pulisciSpazi(input);
  s = spaziSingoli(s);
  return s.slice(0, 20000).trim();
}

export type Normalizzazione =
  | { tipo: "titolo" | "titolo_youtube" | "descrizione" | "script"; prima: string; dopo: string }
  | null;

/** Normalizza e, se il risultato cambia il testo, descrive la correzione. */
export function normalizzaConDiff(
  campo: "titolo" | "titolo_youtube" | "descrizione" | "script",
  valore: string | null,
): { valore: string | null; diff: Normalizzazione } {
  if (valore == null) return { valore, diff: null };
  const fn =
    campo === "titolo"
      ? normalizzaTitolo
      : campo === "titolo_youtube"
        ? normalizzaTitoloYouTube
        : campo === "descrizione"
          ? normalizzaDescrizione
          : normalizzaScript;
  const dopo = fn(valore);
  if (dopo === valore) return { valore, diff: null };
  return { valore: dopo, diff: { tipo: campo, prima: valore, dopo } };
}

/** Testo leggibile della correzione, es. "Titolo corretto: X → Y". */
export function messaggioDiff(diff: { tipo: string; prima: string; dopo: string }): string {
  const etichetta =
    diff.tipo === "titolo"
      ? "Titolo"
      : diff.tipo === "titolo_youtube"
        ? "Titolo YouTube"
        : diff.tipo === "descrizione"
          ? "Descrizione"
          : "Script";
  return `${etichetta} corretto: “${diff.prima}” → “${diff.dopo}”`;
}
