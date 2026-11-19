import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CalendarEvent,
  ChatMessage,
  Meeting,
  MeetingDetail,
  MeetingSummary,
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
  deleteMeeting: (id: string) => invoke<void>("delete_meeting", { id }),

  listAudioDevices: () => invoke<string[]>("list_audio_devices"),
  startRecording: (meetingId: string) => invoke<void>("start_recording", { meetingId }),
  stopRecording: () => invoke<void>("stop_recording"),
  recordingStatus: () => invoke<RecordingStatus>("recording_status"),

  enhanceNotes: (meetingId: string, streamId: string) =>
    invoke<string>("enhance_notes", { meetingId, streamId }),
  getChat: (scope: string) => invoke<ChatMessage[]>("get_chat", { scope }),
  clearChat: (scope: string) => invoke<void>("clear_chat", { scope }),
  chat: (scope: string, question: string, streamId: string) =>
    invoke<ChatMessage>("chat", { scope, question, streamId }),

  listTemplates: () => invoke<Template[]>("list_templates"),
  saveTemplate: (template: Template) => invoke<Template>("save_template", { template }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  hasApiKey: () => invoke<boolean>("has_api_key"),
  setApiKey: (key: string) => invoke<void>("set_api_key", { key }),

  listWhisperModels: () => invoke<WhisperModelInfo[]>("list_whisper_models"),
  downloadWhisperModel: (name: string) => invoke<void>("download_whisper_model", { name }),

  upcomingEvents: (force = false) => invoke<CalendarEvent[]>("upcoming_events", { force }),
};

export interface AudioLevel {
  meetingId: string;
  mic: number;
  system: number | null;
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
  "audio-level": AudioLevel;
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
  return Math.random().toString(36).slice(2);
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
