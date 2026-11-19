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
  /** "me" = microfono, "them" = audio di sistema, "file" = file audio caricato */
  source: "me" | "them" | "file";
  startMs: number;
  endMs: number;
  text: string;
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
  icsUrl: string | null;
  notifyBeforeMin: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  attendees: string[];
  location: string | null;
  meetingId: string | null;
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

export type View =
  | { kind: "meeting"; id: string }
  | { kind: "chat" }
  | { kind: "settings" }
  | { kind: "templates" }
  | { kind: "home" };
