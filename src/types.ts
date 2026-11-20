export interface Meeting {
  id: string;
  title: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  calendarEventId: string | null;
  attendees: string[];
  tags: string[];
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

/** Un tag promosso a progetto. */
export interface Project {
  tag: string;
  archived: boolean;
}

export type View =
  | { kind: "meeting"; id: string }
  | { kind: "chat" }
  | { kind: "library" }
  | { kind: "settings" }
  | { kind: "templates" }
  | { kind: "home" };
