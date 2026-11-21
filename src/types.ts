export interface Meeting {
  id: string;
  title: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  calendarEventId: string | null;
  attendees: string[];
  tags: string[];
  /** Il progetto in cui sta, se ne ha uno. */
  projectId: string | null;
  templateId: string | null;
  notesMd: string;
  enhancedMd: string | null;
  privacy: Privacy;
}

/**
 * Quanto di un meeting può uscire da questo Mac: "open" segue le impostazioni, "audio" tiene
 * l'audio in locale, "hardened" non fa uscire niente (solo modelli locali).
 */
export type Privacy = "open" | "audio" | "hardened";

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
  tags: string[];
  projectId: string | null;
  snippet: string | null;
}

export interface Person {
  id: number;
  name: string;
  email: string | null;
  meetings: number;
}

export interface PersonSuggestion {
  name: string;
  email: string | null;
  source: "people" | "calendar";
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
  enabled: boolean;
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
  /** Un'emoji scelta dall'utente; vuota = l'icona predefinita. */
  icon: string;
  description: string;
  archived: boolean;
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
  | { kind: "library" }
  | { kind: "settings" }
  | { kind: "templates" }
  | { kind: "home" };
