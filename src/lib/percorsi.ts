/**
 * Validazione percorsi interni — modulo client-safe (nessun import da
 * next/server, usabile anche nei Client Component).
 */

/** Valida un redirect "next" per evitare open redirect (es. /login?next=https://maligno). */
export function percorsoInternoValido(next: string | null): boolean {
  if (!next) return false;
  // Solo path relativi che iniziano con una singola "/".
  // Esclude: "//evil.com", "https://...", "javascript:", ecc.
  return /^\/(?!\/)[a-zA-Z0-9/_-]*$/.test(next);
}
