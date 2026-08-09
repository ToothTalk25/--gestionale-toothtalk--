export type UserRole = "admin" | "member";

export type TaskStatus =
  | "da_fare"
  | "consegnato"
  | "in_revisione"
  | "modificato_admin"
  | "approvato"
  | "pubblicato"
  | "respinto";

export type DeliverableKind =
  | "script"
  | "video_grezzo"
  | "thumbnail"
  | "liberatoria"
  | "audio"
  | "altro"
  | "descrizione"
  // Materiali del pacchetto pubblicabile: archivio separato, certificati PEC.
  | "finale_video"
  | "finale_copertina"
  | "finale_liberatoria";

/** Dove finisce il file: lavorazione (bucket originali) o pacchetto (bucket finali). */
export type Archivio = "lavorazione" | "finale";

export type VersionOrigin = "originale" | "admin_edit";

// Vocabolario editoriale, non di assegnazione compiti: la partecipazione al
// progetto è libera e non prevede incarichi, scadenze vincolanti o consegne
// dovute. Gli identificativi tecnici nel database restano invariati.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  da_fare: "In preparazione",
  consegnato: "Completato",
  in_revisione: "In revisione",
  modificato_admin: "Rielaborato",
  approvato: "Approvato",
  pubblicato: "Pubblicato",
  respinto: "Da rivedere",
};

/** Stati impostabili da chi partecipa al gruppo (vedi fn_tasks_guard). */
export const STATI_MEMBRO: TaskStatus[] = ["da_fare", "consegnato", "in_revisione"];

export const KIND_LABEL: Record<DeliverableKind, string> = {
  script: "Script di lavorazione",
  video_grezzo: "Video in lavorazione",
  thumbnail: "Copertina",
  liberatoria: "Liberatoria privacy/immagine",
  audio: "Audio",
  altro: "Altro",
  descrizione: "Descrizione",
  finale_video: "Video montato (pubblicabile)",
  finale_copertina: "Copertina (pubblicabile)",
  finale_liberatoria: "Liberatoria (pubblicabile)",
};

// "audio" e "liberatoria" restano nel tipo (compatibilità con l'enum del
// database) ma non compaiono come slot separati qui: l'audio non è mai stato
// un materiale a sé, la liberatoria vive esclusivamente nel pacchetto
// pubblicabile (compare solo quando il progetto la richiede). Lo script, in
// lavorazione, è la bozza di ciò che si dirà nel video: il pacchetto porta
// invece lo script usato davvero.
/** Materiali di processo: immutabili una volta consegnati, ma non certificati. */
export const KIND_LAVORAZIONE: DeliverableKind[] = [
  "video_grezzo",
  "script",
  "descrizione",
  "thumbnail",
  "altro",
];

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  attivo: boolean;
};

export type Polo = {
  id: string;
  nome: string;
  slug: string;
  citta: string | null;
  attivo: boolean;
};

export type Task = {
  id: string;
  polo_id: string;
  titolo: string;
  script: string | null;
  descrizione: string | null;
  note_admin: string | null;
  status: TaskStatus;
  scadenza: string | null;
  locked: boolean;
  coinvolge_terzi: boolean;
  published_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Deliverable = {
  id: string;
  task_id: string;
  kind: DeliverableKind;
  titolo: string | null;
  created_by: string | null;
  created_at: string;
};

export type DeliverableVersion = {
  id: string;
  deliverable_id: string;
  version_no: number;
  origin: VersionOrigin;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string;
  prev_record_hash: string | null;
  record_hash: string;
  uploaded_by: string;
  uploaded_at: string;
  sealed_at: string | null;
  note: string | null;
};

// ---------------------------------------------- pacchetto pubblicabile

export type PacchettoStato =
  | "bozza"
  | "pronto"
  | "sigillato"
  | "pec_inviata"
  | "pec_confermata"
  | "pec_errore"
  | "annullato";

export const PACCHETTO_LABEL: Record<PacchettoStato, string> = {
  bozza: "In composizione",
  pronto: "Pronto per la revisione",
  sigillato: "Sigillato — da spedire",
  pec_inviata: "PEC inviata",
  pec_confermata: "PEC consegnata",
  pec_errore: "Errore di spedizione",
  annullato: "Annullato",
};

export type RuoloElemento = "video" | "copertina" | "liberatoria";

export type PacchettoVideoRow = {
  id: string;
  task_id: string;
  descrizione: string | null;
  script: string | null;
  stato: PacchettoStato;
  manifest: ManifestoPacchetto | null;
  manifest_hash: string | null;
  sigillato_at: string | null;
  sigillato_da: string | null;
  pronto_at: string | null;
  pec_destinatari: string[] | null;
  pec_message_id: string | null;
  pec_inviata_at: string | null;
  pec_errore: string | null;
  pec_ricevuta_note: string | null;
  annullato_motivo: string | null;
  created_at: string;
};

export type ElementoManifesto =
  | {
      ruolo: RuoloElemento;
      tipo: "file";
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      sha256: string;
      bucket: string;
      storage_path: string;
      version_id: string;
      record_hash: string;
      caricato_da: string;
      caricato_at: string;
    }
  | {
      ruolo: "descrizione" | "script";
      tipo: "testo";
      sha256: string;
      caratteri: number;
      testo: string;
    };

export type ManifestoPacchetto = {
  versione_formato: number;
  emittente: string;
  pacchetto_id: string;
  task: { id: string; titolo: string };
  polo: { id: string; nome: string; citta: string | null };
  sigillato_at: string;
  sigillato_da: { id: string; email: string; nome: string | null };
  elementi: ElementoManifesto[];
  manifest_hash?: string;
};

// ------------------------------------------------ richieste di modifica

export type AmbitoRichiesta =
  | "video"
  | "copertina"
  | "descrizione"
  | "script"
  | "generale";

export const AMBITO_LABEL: Record<AmbitoRichiesta, string> = {
  video: "Video",
  copertina: "Copertina",
  descrizione: "Descrizione",
  script: "Script",
  generale: "Generale",
};

export type RichiestaModifica = {
  id: string;
  task_id: string;
  pacchetto_id: string | null;
  ambito: AmbitoRichiesta;
  testo: string;
  stato: "aperta" | "risolta";
  creata_da: string | null;
  creata_at: string;
  risolta_da: string | null;
  risolta_at: string | null;
  nota_risposta: string | null;
};

export type VideoDaRivedere = {
  pacchetto_id: string;
  task_id: string;
  progetto: string;
  polo_id: string;
  gruppo: string;
  stato: PacchettoStato;
  sigillato_at: string | null;
  pec_inviata_at: string | null;
  coinvolge_terzi: boolean;
  richieste_aperte: number;
  ultima_richiesta: string | null;
};

/** Pacchetti segnalati dal gruppo come completati, in attesa della revisione di chi ha accesso globale. */
export type PacchettoPronto = {
  pacchetto_id: string;
  task_id: string;
  progetto: string;
  polo_id: string;
  gruppo: string;
  stato: PacchettoStato;
  pronto_at: string | null;
  sigillato_at: string | null;
};

/** Contesto di sessione risolto lato server a ogni richiesta. */
export type SessionContext = {
  profile: Profile;
  poli: Polo[];
  isAdmin: boolean;
};
