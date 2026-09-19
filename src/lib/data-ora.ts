/**
 * Le date si scrivono SEMPRE con il fuso dell'Italia, anche quando a
 * formattarle è il server.
 *
 * Perché non basta `toLocaleString("it-IT")`. Senza un fuso dichiarato, la
 * stessa data diventa due stringhe diverse a seconda di chi la scrive: il
 * server del progetto (Vercel, `fra1`) sta su **UTC**, il browser di chi guarda
 * sta sull'**ora italiana**. Due conseguenze, entrambe viste davvero:
 *
 *  1. **L'ora sbagliata per due ore.** Email, verbali PDF e pagine disegnate
 *     dal server scrivevano l'ora di Greenwich: un documento con valore legale
 *     che dice "spedita alle 01:02" quando in Italia erano le 03:02.
 *  2. **React butta via il disegno del server** (errore #418 di idratazione,
 *     visto in produzione sulle pagine del Registro): la pagina arriva già
 *     scritta dal server, poi il browser la riscrive con l'ora locale, trova
 *     due testi diversi e rifà tutto l'albero. Flicker e lavoro inutile.
 *
 * Dichiarando il fuso qui, server e browser scrivono la stessa identica
 * stringa — e chi guarda il gestionale da fuori l'Italia vede comunque l'ora
 * italiana, che è quella con cui il progetto firma i suoi documenti.
 */

const FUSO = "Europe/Rome";

function istante(valore: string | number | Date | null | undefined): Date | null {
  if (valore === null || valore === undefined || valore === "") return null;
  const d = valore instanceof Date ? valore : new Date(valore);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data e ora: «19/09/2026, 03:02:31» */
export function dataOra(valore: string | number | Date | null | undefined): string {
  const d = istante(valore);
  return d ? d.toLocaleString("it-IT", { timeZone: FUSO }) : "—";
}

/** Solo la data: «19/09/2026» */
export function soloData(valore: string | number | Date | null | undefined): string {
  const d = istante(valore);
  return d ? d.toLocaleDateString("it-IT", { timeZone: FUSO }) : "—";
}

/** Solo l'ora: «03:02:31» */
export function soloOra(valore: string | number | Date | null | undefined): string {
  const d = istante(valore);
  return d ? d.toLocaleTimeString("it-IT", { timeZone: FUSO }) : "—";
}

/** Data scritta per esteso: «19 settembre 2026» */
export function dataEstesa(valore: string | number | Date | null | undefined): string {
  const d = istante(valore);
  return d
    ? d.toLocaleDateString("it-IT", { timeZone: FUSO, day: "2-digit", month: "long", year: "numeric" })
    : "—";
}
