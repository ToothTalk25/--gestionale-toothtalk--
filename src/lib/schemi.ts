import { z } from "zod";

/**
 * Schemi Zod per la validazione rigorosa dei payload delle Server Actions.
 *
 * Zero Trust: nessun dato proveniente dal client viene fidato. Gli schemi
 * qui sotto impongono tipo, formato e limiti di ogni campo PRIMA che la
 * query parta — un payload malformato (id non-uuid, stringhe fuori limite,
 * enum inventati) viene rifiutato subito con un errore leggibile.
 */

// ------------------------------------------------------------- primitivi

export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "ID non valido");

export const titoloSchema = z
  .string()
  .trim()
  .min(1, "Il titolo è obbligatorio.")
  .max(120, "Il titolo è troppo lungo.");

export const testoLiberoSchema = (max: number, campo: string) =>
  z.string().trim().max(max, `${campo} è troppo lungo.`);

export const urlGoogleDocSchema = z
  .string()
  .trim()
  .refine(
    (u) =>
      u.startsWith("https://docs.google.com/document/") ||
      u.startsWith("https://docs.google.com/document/u/"),
    "Inserisci un link valido di Google Documenti.",
  );

// ---------------------------------------------------------------- azioni

export const creaTaskSchema = z.object({
  polo_id: uuidSchema,
  titolo: titoloSchema,
  script: testoLiberoSchema(20000, "Lo script").nullable().optional(),
  scadenza: z.string().date("Data non valida.").nullable().optional(),
  formato_id: uuidSchema.nullable().optional(),
});

export const aggiornaTestiSchema = z.object({
  taskId: uuidSchema,
  campi: z.object({
    titolo: titoloSchema.optional(),
    script: testoLiberoSchema(20000, "Lo script").nullable().optional(),
    note_admin: testoLiberoSchema(5000, "Le note").nullable().optional(),
    numero_video: z.number().int().positive().max(9999).nullable().optional(),
  }),
});

export const eliminaProjettoSchema = z.object({
  taskId: uuidSchema,
});

export const archiviaFileFinaleSchema = z.object({
  taskId: uuidSchema,
  versionId: uuidSchema,
});

export const impostaCoinvolgeTerziSchema = z.object({
  taskId: uuidSchema,
  coinvolgeTerzi: z.boolean(),
});

export const cambiaStatoSchema = z.object({
  taskId: uuidSchema,
  status: z.enum([
    "da_fare",
    "consegnato",
    "in_revisione",
    "modificato_admin",
    "approvato",
    "sigillato",
    "pubblicato",
    "respinto",
  ]),
});

export const impostaBloccoSchema = z.object({
  taskId: uuidSchema,
  locked: z.boolean(),
});

export const preparaUploadSchema = z.object({
  taskId: uuidSchema,
  kind: z.enum([
    "script",
    "video_grezzo",
    "immagini_montaggio",
    "thumbnail",
    "liberatoria",
    "audio",
    "altro",
    "descrizione",
    "titolo_youtube",
    "finale_video",
    "finale_copertina",
    "finale_liberatoria",
  ]),
  titolo: titoloSchema.optional(),
});

export const registraVersioneSchema = z.object({
  taskId: uuidSchema,
  deliverableId: uuidSchema,
  origin: z.enum(["originale", "admin_edit"]),
  archivio: z.enum(["lavorazione", "finale"]),
  storagePath: z
    .string()
    .min(3)
    .max(500)
    .regex(/^[a-zA-Z0-9._/-]+$/, "Path di storage non valido"),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(200).nullable().optional(),
  sizeBytes: z.number().int().positive().max(6 * 1024 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i, "Impronta SHA-256 non valida"),
  note: testoLiberoSchema(500, "La nota").nullable().optional(),
});

export const eliminaVersioneSchema = z.object({
  taskId: uuidSchema,
  versionId: uuidSchema,
});

export const urlFirmatoSchema = z.object({
  bucket: z.enum(["originali", "finali", "revisioni", "profili"]),
  path: z
    .string()
    .min(3)
    .max(500)
    .regex(/^[a-zA-Z0-9._/-]+$/, "Path di storage non valido"),
  secondi: z.number().int().min(1).max(3600).optional(),
});

export const salvaPacchettoSchema = z.object({
  taskId: uuidSchema,
  campi: z.object({
    descrizione: testoLiberoSchema(5000, "La descrizione").optional(),
    script: testoLiberoSchema(20000, "Lo script").optional(),
    titolo_youtube: testoLiberoSchema(150, "Il titolo YouTube").optional(),
  }),
});
