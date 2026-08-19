/**
 * Validazione server-side dei file caricati (Upload DoS / MIME reale).
 *
 * L'estensione e il Content-Type dichiarato dal client sono inaffidabili:
 * un utente può caricare un eseguibile rinominandolo .mp4. Qui si controllano
 * i MAGIC BYTES (i primi byte del contenuto), che identificano il formato
 * reale indipendentemente dal nome. In più si impongono limiti dimensionali
 * per kind, per prevenire la saturazione dello storage (Denial of Service).
 */

export type TipoRilevato =
  | "video/mp4"
  | "video/quicktime"
  | "video/webm"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "application/pdf"
  | "testo"
  | "sconosciuto";

/** Riconosce il formato reale dai primi byte del file. */
export function rilevaTipo(bytes: Uint8Array): TipoRilevato {
  // MP4: box "ftyp" in posizione 4..8
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "video/mp4";
  }
  // QuickTime (.mov): box "moov" o "mdat" in testa, o ftyp con brand qt
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && brand === "qt  ") {
    return "video/quicktime";
  }
  if (bytes.length >= 4 && bytes[0] === 0x6d && bytes[1] === 0x6f && bytes[2] === 0x6f && bytes[3] === 0x76) {
    return "video/quicktime";
  }
  // WebM / Matroska (EBML 0x1A45DFA3)
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "video/webm";
  }
  // PNG
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // PDF
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  // Testo puro (utf-8/ascii): nessun byte di controllo binario nei primi 64
  const campione = Math.min(bytes.length, 64);
  let binario = false;
  for (let i = 0; i < campione; i++) {
    const b = bytes[i];
    if (b === 0 || (b < 0x09) || (b > 0x0d && b < 0x20) || b === 0x7f) {
      binario = true;
      break;
    }
  }
  if (!binario && campione > 0) return "testo";

  return "sconosciuto";
}

/** Limiti dimensionali per kind (in byte). */
export const LIMITI_KIND: Record<string, number> = {
  video_grezzo: 6 * 1024 * 1024 * 1024, // 6 GB
  finale_video: 6 * 1024 * 1024 * 1024,
  immagini_montaggio: 100 * 1024 * 1024, // 100 MB
  thumbnail: 20 * 1024 * 1024, // 20 MB
  finale_copertina: 20 * 1024 * 1024,
  liberatoria: 20 * 1024 * 1024,
  finale_liberatoria: 20 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  script: 1024 * 1024,
  descrizione: 1024 * 1024,
  titolo_youtube: 1024 * 1024,
  altro: 500 * 1024 * 1024,
};

/** Tipi MIME reali ammessi per kind. */
export const MIME_AMMESSI: Record<string, TipoRilevato[]> = {
  video_grezzo: ["video/mp4", "video/quicktime", "video/webm"],
  finale_video: ["video/mp4", "video/quicktime", "video/webm"],
  immagini_montaggio: ["image/png", "image/jpeg", "image/webp"],
  thumbnail: ["image/png", "image/jpeg", "image/webp"],
  finale_copertina: ["image/png", "image/jpeg", "image/webp"],
  liberatoria: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  finale_liberatoria: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  audio: ["sconosciuto"], // audio: formato libero, basta il limite di dimensione
  script: ["testo", "application/pdf"],
  descrizione: ["testo", "application/pdf"],
  titolo_youtube: ["testo"],
  altro: ["sconosciuto"], // "altro": nessun vincolo di formato, solo dimensione
};

export type EsitoVerifica =
  | { ok: true }
  | { ok: false; errore: string };

/**
 * Verifica un upload: dimensione entro i limiti del kind e formato reale
 * compatibile. `bytes` sono i primi ~512 byte del file.
 */
export function verificaUpload(kind: string, sizeBytes: number, bytes: Uint8Array): EsitoVerifica {
  // 1. Dimensione
  const limite = LIMITI_KIND[kind];
  if (limite && sizeBytes > limite) {
    const mb = Math.round(limite / (1024 * 1024));
    return { ok: false, errore: `File troppo grande: il limite per questo tipo è ${mb} MB.` };
  }

  // 2. Formato reale (magic bytes)
  if (kind === "altro" || kind === "audio") return { ok: true }; // nessun vincolo di formato

  const tipo = rilevaTipo(bytes);
  const ammessi = MIME_AMMESSI[kind];
  if (tipo === "sconosciuto") {
    return { ok: false, errore: "File non riconosciuto: il contenuto non corrisponde a un formato valido." };
  }
  if (ammessi && !ammessi.includes(tipo)) {
    return {
      ok: false,
      errore: `Formato non consentito per questo tipo di materiale (rilevato: ${tipo}).`,
    };
  }
  return { ok: true };
}

/** Legge i primi N byte di un file passato come Blob (usato lato server). */
export async function primiByte(buffer: Buffer, n = 512): Promise<Uint8Array> {
  return new Uint8Array(buffer.subarray(0, n));
}
