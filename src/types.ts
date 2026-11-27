import type { SettingsSection } from "./components/SettingsNav";
export interface Meeting {
  id: string;
  title: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  calendarEventId: string | null;
  attendees: string[];
  /** I gruppi presenti (id), oltre alle persone una per una. */
  groupIds: string[];
  tags: string[];
  /** Il progetto in cui sta, se ne ha uno. */
  projectId: string | null;
  /** Quando è stato fissato in cima alla barra laterale; null se non è fissato. */
  pinnedAt: number | null;
  templateId: string | null;
  notesMd: string;
  enhancedMd: string | null;
  privacy: Privacy;
  /** Ultima modifica di titolo, note, note AI, partecipanti o tag. */
  updatedAt: number;
}

/**
 * Quanto di un meeting può uscire da questo Mac: "open" segue le impostazioni, "audio" tiene
 * l'audio in locale, "hardened" non fa uscire niente (solo modelli locali).
 */
export type Privacy = "open" | "audio" | "hardened";

/**
 * Un vault: una cartella con il suo database, i suoi allegati e le sue registrazioni. Se ne
 * apre uno alla volta, e l'app mostra i meeting di quello aperto.
 */
export interface Vault {
  id: string;
  name: string;
  path: string;
  /** I meeting del vault non scendono sotto questo livello di privacy. */
  minPrivacy: Privacy;
  /** Il vault principale: c'è sempre, non si rinomina e non si toglie. */
  main: boolean;
  /** È quello aperto. */
  active: boolean;
  /** La sua cartella è raggiungibile (un disco esterno può non essere collegato). */
  available: boolean;
  /** I calendari (configurati una volta nelle impostazioni) che questo vault non mostra. */
  hiddenCalendars: string[];
  /** Il nome del computer che lo ha aperto, se è un altro: qui non si apre finché non lo chiude. */
  heldBy: string | null;
}

/**
 * Il sync del vault aperto attraverso una cartella (fase 0: anteprima per sviluppatori).
 */
export interface SyncStatus {
  /** Il sync c'è: build di sviluppo, oppure anteprime per sviluppatori accese. */
  available: boolean;
  /** Perché il vault aperto non si può sincronizzare, se non si può. */
  blocked: string | null;
  /** La cartella di sync, se è attivo. */
  dir: string | null;
  lastSync: number | null;
  /** I dispositivi che hanno scritto nella cartella, questo compreso. */
  devices: number;
  /** Modifiche di questo Mac non ancora scritte nella cartella. */
  pending: number;
  /** Versioni di note tenute da parte dopo una modifica fatta in contemporanea su due Mac. */
  conflicts: number;
  error: string | null;
}

/** Una parte di trascrizione: un segmento intero, oppure i suoi caratteri da `start` a `end`. */
export interface TranscriptPart {
  id: number;
  start?: number;
  end?: number;
}

export interface MeetingSummary {
  id: string;
  title: string;
  createdAt: number;
  hasEnhanced: boolean;
  attendees: string[];
  /** I gruppi presenti (id). */
  groupIds: string[];
  tags: string[];
  projectId: string | null;
  /** Quando è stato fissato; null se non è fissato. */
  pinnedAt: number | null;
  /** Ultima modifica di titolo, note, note AI, partecipanti o tag. */
  updatedAt: number;
  snippet: string | null;
}

export interface Person {
  id: number;
  name: string;
  email: string | null;
  meetings: number;
  /** Quando è stato creato l'ultimo meeting a cui ha partecipato. */
  lastMeetingAt: number | null;
}

/**
 * Come entra un gruppo in una nota: "team" porta con sé i membri come partecipanti, uno per
 * uno; "audience" (tutta l'azienda, un reparto) resta un solo chip.
 */
export type GroupKind = "team" | "audience";

/** Un gruppo di persone, dentro un altro gruppo o di primo livello. */
export interface Group {
  id: string;
  name: string;
  /** Uno dei colori dei progetti; vuoto = quello predefinito. */
  color: string;
  description: string;
  parentId: string | null;
  kind: GroupKind;
  /** I nomi dei membri, come in rubrica. */
  members: string[];
  /** In quante note compare. */
  meetings: number;
  lastMeetingAt: number | null;
}

/** Fino a quanti membri un gruppo nuovo è un team (oltre, un pubblico). */
export const TEAM_SIZE = 15;

/** Una persona letta da un file vCard; `known` se è già in rubrica. */
export interface ImportedPerson {
  name: string;
  email: string | null;
  known: boolean;
}

/** Quanto si può leggere della rubrica del Mac. */
export type ContactsAccess =
  | "unsupported"
  | "notDetermined"
  | "denied"
  | "restricted"
  | "authorized"
  | "limited";

export interface PersonSuggestion {
  name: string;
  email: string | null;
  source: "people" | "calendar" | "contacts";
}

export interface TagCount {
  name: string;
  count: number;
}

export interface TranscriptSegment {
  id: number;
  meetingId: string;
  /**
   * "me" = microfono, "them" = audio di sistema, "file" = file audio caricato. Dopo
   * l'affinamento online è il nome del parlante ("Parlante 1", poi quello che gli si dà).
   */
  source: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Segnato "da verificare": finché lo è, il meeting non va a modelli non locali. */
  review?: boolean;
}

export interface MeetingDetail {
  meeting: Meeting;
  segments: TranscriptSegment[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  instructions: string;
  builtin: boolean;
  /** Le note da cui parte un meeting con questo template (Markdown); vuote se non ne ha. */
  notesMd: string;
}

/** Ciò che l'AI propone per un template descritto a parole. */
export interface TemplateDraft {
  name: string;
  description: string;
  instructions: string;
  notesMd: string;
}

export interface ChatMessage {
  id: number;
  scope: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface Provider {
  id: string;
  name: string;
  kind: "anthropic" | "openai";
  baseUrl: string;
  contextTokens: number | null;
}

export interface ModelRef {
  providerId: string;
  model: string;
}

export interface Settings {
  userName: string;
  /** "system" | "it" | "en" */
  uiLanguage: string;
  providers: Provider[];
  notesModel: ModelRef;
  chatModel: ModelRef;
  language: string;
  whisperModel: string;
  micDevice: string | null;
  systemDevice: string | null;
  calendars: Calendar[];
  notifyBeforeMin: number;
  /** A fine riunione l'audio viene caricato su Gladia per una trascrizione con i parlanti. */
  onlineTranscription: boolean;
  /** Formato dell'ora: "system" segue macOS, "24" oppure "12" (AM/PM). */
  timeFormat: string;
  /** Salva l'audio di ogni registrazione, per riascoltarlo. */
  saveRecordings: boolean;
  /** Cartella delle registrazioni; null = quella predefinita. */
  recordingsDir: string | null;
  /** Alla fine toglie dalla registrazione le pause senza audio (serve ffmpeg). */
  trimSilence: boolean;
  /** La scheda dei dati di esempio nella Home è stata chiusa: restano in Impostazioni. */
  hideDemoCard: boolean;
  /** Propone i nomi della rubrica del Mac tra i partecipanti. Spento di default. */
  contactsSuggestions: boolean;
  /** Mostra anche nelle build pubblicate le funzioni in anteprima (per ora il sync). */
  developerPreviews: boolean;
}

/** Una registrazione salvata: l'audio di una sessione di registrazione di un meeting. */
export interface Recording {
  id: number;
  meetingId: string;
  meetingTitle: string;
  path: string;
  startedAt: number;
  durationMs: number;
  bytes: number;
  /** Le pause sono state tolte: i minuti non corrispondono più alla trascrizione. */
  trimmed: boolean;
}

/** Un file della Libreria che non è una registrazione: un allegato di una nota o un file senza nota. */
export interface LibraryFile {
  id: string;
  /** `attachments/…`, come nelle note. */
  path: string;
  name: string;
  bytes: number;
  meetingId: string | null;
  meetingTitle: string | null;
  /** La cartella da cui veniva un file senza nota. */
  folder: string | null;
  at: number;
  /** Il file non c'è più nella cartella degli allegati. */
  missing: boolean;
}

/** Un file o una nota lasciati fuori da un import, con il perché. */
export interface ImportSkipped {
  path: string;
  reason: string;
}

/** Cosa importerebbe (o ha importato) una cartella Obsidian. */
export interface ImportSummary {
  obsidian: boolean;
  notes: number;
  attachments: number;
  loose: number;
  projects: string[];
  already: number;
  changed: string[];
  missingLinks: number;
  skipped: ImportSkipped[];
}

/** Un import fatto, che si può annullare. */
export interface ImportRecord {
  id: string;
  source: string;
  root: string;
  createdAt: number;
  /** Note e file senza nota che ne restano. */
  notes: number;
  files: number;
  report: ImportSummary | null;
}

/** Dove finiscono le registrazioni e se su questo Mac c'è ffmpeg. */
export interface RecordingsInfo {
  dir: string;
  defaultDir: string;
  ffmpeg: boolean;
}

/** Un calendario configurato. L'indirizzo iCal è un segreto. */
export interface Calendar {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

/** Stato di un calendario per la home, senza l'indirizzo. */
export interface CalendarInfo {
  id: string;
  name: string;
  /** Attivo nelle impostazioni: spento, non compare in nessun vault. */
  enabled: boolean;
  /** Il vault aperto lo mostra. */
  shown: boolean;
  error: string | null;
}

export interface CalendarOverview {
  calendars: CalendarInfo[];
  events: CalendarEvent[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  attendees: string[];
  location: string | null;
  meetingId: string | null;
  calendarId: string;
}

export interface WhisperModelInfo {
  name: string;
  sizeMb: number;
  downloaded: boolean;
  description: string;
}

export interface RecordingStatus {
  meetingId: string | null;
  recording: boolean;
  /** la sessione in corso trascrive un file caricato, non l'audio live */
  importing: boolean;
  pendingChunks: number;
}

/** Un progetto: raccoglie i meeting che gli appartengono. Un meeting sta in uno al massimo. */
export interface Project {
  id: string;
  name: string;
  /** Uno dei colori di `PROJECT_COLORS`; vuoto = il colore predefinito. */
  color: string;
  description: string;
  archived: boolean;
  /** Il progetto che lo contiene; null = di primo livello. */
  parentId: string | null;
}

/** Un elemento che la Libreria mostra attraverso i meeting, letto dalle note. */
export type ItemKind = "decision" | "action" | "quote";

export interface LibraryItem {
  meetingId: string;
  kind: ItemKind;
  /** Markdown in linea, così com'è nella nota. */
  text: string;
  /** Solo per le azioni: la voce è spuntata. */
  done: boolean;
  /** Solo per le citazioni: chi l'ha detta e a che minuto (ms). */
  who: string | null;
  ms: number | null;
}

export type View =
  | { kind: "meeting"; id: string }
  | { kind: "chat" }
  | { kind: "library"; person?: string; group?: string; all?: boolean }
  | { kind: "people"; group?: string }
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "home" };
