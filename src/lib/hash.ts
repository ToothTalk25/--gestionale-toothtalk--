"use client";

/**
 * SHA-256 del file calcolato nel browser in streaming.
 *
 * Usa hash-wasm (SHA-256 standard, identico a `shasum -a 256`): l'impronta
 * deve combaciare con quella ricalcolata lato server/PEC per avere valore
 * probatorio. hash-wasm è importato DINAMICAMENTE solo quando parte un
 * upload: così i suoi ~2MB di WASM non appesantiscono i bundle caricati
 * all'apertura delle pagine (l'upload avviene sempre dopo un click).
 *
 * L'impronta è ciò che rende dimostrabile "questo è esattamente il file che
 * ho consegnato il giorno X": viene sigillata nel registro insieme al
 * timestamp del server e concatenata alla versione precedente.
 */
export async function sha256File(
  file: File,
  onProgress?: (frazione: number) => void,
): Promise<string> {
  const { createSHA256 } = await import("hash-wasm");
  const hasher = await createSHA256();
  hasher.init();

  const CHUNK = 8 * 1024 * 1024;
  let offset = 0;

  while (offset < file.size) {
    const blob = file.slice(offset, offset + CHUNK);
    const buf = new Uint8Array(await blob.arrayBuffer());
    hasher.update(buf);
    offset += CHUNK;
    onProgress?.(Math.min(offset / file.size, 1));
  }

  return hasher.digest("hex");
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
