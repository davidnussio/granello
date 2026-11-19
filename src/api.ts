import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CalendarEvent,
  ChatMessage,
  Meeting,
  MeetingDetail,
  MeetingSummary,
  Person,
  PersonSuggestion,
  TagCount,
  Provider,
  RecordingStatus,
  Settings,
  Template,
  TranscriptSegment,
  WhisperModelInfo,
} from "./types";

export const api = {
  listMeetings: (query?: string) => invoke<MeetingSummary[]>("list_meetings", { query }),
  getMeeting: (id: string) => invoke<MeetingDetail>("get_meeting", { id }),
  createMeeting: (args: {
    title: string;
    calendarEventId?: string;
    attendees?: string[];
    templateId?: string;
  }) => invoke<Meeting>("create_meeting", args),
  updateMeeting: (args: {
    id: string;
    title?: string;
    notesMd?: string;
    enhancedMd?: string;
    templateId?: string;
  }) => invoke<void>("update_meeting", args),
  updateMeetingMeta: (args: { id: string; attendees?: string[]; tags?: string[] }) =>
    invoke<Meeting>("update_meeting_meta", args),
  deleteMeeting: (id: string) => invoke<void>("delete_meeting", { id }),

  listTags: () => invoke<TagCount[]>("list_tags"),
  listPeople: () => invoke<Person[]>("list_people"),
  deletePerson: (id: number) => invoke<void>("delete_person", { id }),
  suggestPeople: (query: string) => invoke<PersonSuggestion[]>("suggest_people", { query }),
  calendarMatch: (meetingId: string) => invoke<CalendarEvent | null>("calendar_match", { meetingId }),

  listAudioDevices: () => invoke<string[]>("list_audio_devices"),
  startRecording: (meetingId: string) => invoke<void>("start_recording", { meetingId }),
  stopRecording: () => invoke<void>("stop_recording"),
  /** Fa scegliere un file audio e lo trascrive nel meeting. false se la scelta viene annullata. */
  importAudio: (meetingId: string) => invoke<boolean>("import_audio", { meetingId }),
  /** Dispositivo per l'audio degli altri (null = solo microfono); vale anche a registrazione in corso. */
  setSystemDevice: (device: string | null) => invoke<void>("set_system_device", { device }),
  recordingStatus: () => invoke<RecordingStatus>("recording_status"),

  enhanceNotes: (meetingId: string, streamId: string) =>
    invoke<string>("enhance_notes", { meetingId, streamId }),
  getChat: (scope: string) => invoke<ChatMessage[]>("get_chat", { scope }),
  clearChat: (scope: string) => invoke<void>("clear_chat", { scope }),
  chat: (scope: string, question: string, streamId: string) =>
    invoke<ChatMessage>("chat", { scope, question, streamId }),
  cancelStream: (streamId: string) => invoke<void>("cancel_stream", { streamId }),

  listTemplates: () => invoke<Template[]>("list_templates"),
  saveTemplate: (template: Template) => invoke<Template>("save_template", { template }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  hasApiKey: (providerId: string) => invoke<boolean>("has_api_key", { providerId }),
  setApiKey: (providerId: string, key: string) => invoke<void>("set_api_key", { providerId, key }),
  aiReady: () => invoke<boolean>("ai_ready"),
  listProviderModels: (provider: Provider) => invoke<string[]>("list_provider_models", { provider }),
  appInfo: () => invoke<AppInfo>("app_info"),
  /** Scrive un errore dell'interfaccia nel file di log dell'app. Non fallisce mai. */
  logError: (message: string) => {
    invoke<void>("log_frontend_error", { message }).catch(() => {});
  },

  listWhisperModels: () => invoke<WhisperModelInfo[]>("list_whisper_models"),
  downloadWhisperModel: (name: string) => invoke<void>("download_whisper_model", { name }),
  deleteWhisperModel: (name: string) => invoke<void>("delete_whisper_model", { name }),

  upcomingEvents: (force = false) => invoke<CalendarEvent[]>("upcoming_events", { force }),
};

export interface AppInfo {
  version: string;
  dataDir: string;
  logDir: string;
}
export interface AudioLevel {
  meetingId: string;
  mic: number;
  system: number | null;
}
export interface ImportProgress {
  meetingId: string;
  doneMs: number;
  totalMs: number | null;
}
export interface LlmDelta {
  streamId: string;
  delta: string;
}
export interface ModelDownload {
  name: string;
  downloaded: number;
  total: number | null;
  done: boolean;
}

type Events = {
  "transcript-segment": TranscriptSegment;
  "transcription-error": { meetingId: string; message: string };
  "recording-error": { meetingId: string; message: string };
  "recording-warning": { meetingId: string; message: string };
  "audio-level": AudioLevel;
  "import-progress": ImportProgress;
  "recording-started": string;
  "recording-stopped": string;
  "recording-finished": string;
  "llm-delta": LlmDelta;
  "model-download": ModelDownload;
  "calendar-updated": null;
  "meeting-starting": CalendarEvent;
};

export function on<K extends keyof Events>(
  event: K,
  cb: (payload: Events[K]) => void,
): () => void {
  let un: UnlistenFn | undefined;
  let cancelled = false;
  listen<Events[K]>(event, (e) => cb(e.payload)).then((u) => {
    if (cancelled) u();
    else un = u;
  });
  return () => {
    cancelled = true;
    un?.();
  };
}

export function newStreamId() {
  return crypto.randomUUID();
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
