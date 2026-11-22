import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CalendarEvent,
  CalendarOverview,
  ChatMessage,
  LibraryItem,
  Meeting,
  MeetingDetail,
  MeetingSummary,
  Person,
  Privacy,
  Project,
  PersonSuggestion,
  TagCount,
  Provider,
  Recording,
  RecordingStatus,
  RecordingsInfo,
  Settings,
  Template,
  TemplateDraft,
  TranscriptPart,
  TranscriptSegment,
  Vault,
  SyncStatus,
  WhisperModelInfo,
} from "./types";

/** Valore di `systemDevice` per l'audio in uscita dal computer (vedi `audio::SYSTEM_AUDIO`). */
export const SYSTEM_AUDIO = "@system";

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
  setMeetingPrivacy: (id: string, privacy: Privacy) => invoke<void>("set_meeting_privacy", { id, privacy }),
  /** Oscura per sempre le parti indicate; ritorna la trascrizione aggiornata. */
  redactTranscript: (meetingId: string, parts: TranscriptPart[]) =>
    invoke<TranscriptSegment[]>("redact_transcript", { meetingId, parts }),
  recordingsInfo: () => invoke<RecordingsInfo>("recordings_info"),
  /** Le registrazioni salvate, dalla più recente; solo quelle di un meeting se indicato. */
  listRecordings: (meetingId?: string) => invoke<Recording[]>("list_recordings", { meetingId }),
  deleteRecording: (id: number) => invoke<void>("delete_recording", { id }),
  /** Toglie le pause senza audio da una registrazione; ritorna l'elenco aggiornato. */
  trimRecording: (id: number) => invoke<Recording[]>("trim_recording", { id }),
  /** Unisce le registrazioni di un meeting in un solo file (serve ffmpeg). */
  mergeRecordings: (meetingId: string) => invoke<void>("merge_recordings", { meetingId }),
  /** La forma d'onda di una registrazione: valori da 0 a 255, uno per barra. */
  recordingWaveform: (id: number) => invoke<number[]>("recording_waveform", { id }),
  /** Fa scegliere la cartella delle registrazioni. null se la scelta viene annullata. */
  pickRecordingsDir: () => invoke<string | null>("pick_recordings_dir"),
  listVaults: () => invoke<Vault[]>("list_vaults"),
  /** Fa scegliere la cartella di un vault. null se la scelta viene annullata. */
  pickVaultDir: () => invoke<string | null>("pick_vault_dir"),
  /** Aggiunge un vault in una cartella (nuovo, o già esistente lì). Non lo apre. */
  createVault: (name: string, path: string, minPrivacy: Privacy) =>
    invoke<Vault[]>("create_vault", { name, path, minPrivacy }),
  /** Cambia nome e privacy minima di un vault (del principale solo la privacy minima). */
  updateVault: (id: string, name: string, minPrivacy: Privacy) =>
    invoke<Vault[]>("update_vault", { id, name, minPrivacy }),
  /** Toglie un vault dall'elenco: la cartella e i suoi dati restano. */
  removeVault: (id: string) => invoke<Vault[]>("remove_vault", { id }),
  /** Apre un vault: da qui in poi i comandi leggono e scrivono i suoi meeting. */
  openVault: (id: string) => invoke<Vault[]>("open_vault", { id }),
  /** Il sync del vault aperto (fase 0: solo nelle build di sviluppo). */
  syncStatus: () => invoke<SyncStatus>("sync_status"),
  /** Fa scegliere la cartella di sync. null se la scelta viene annullata. */
  pickSyncDir: () => invoke<string | null>("pick_sync_dir"),
  /** Sincronizza il vault aperto in una cartella, e fa subito il primo giro. */
  enableSync: (dir: string) => invoke<SyncStatus>("enable_sync", { dir }),
  /** Smette di sincronizzare il vault aperto: la cartella resta com'è. */
  disableSync: () => invoke<SyncStatus>("disable_sync"),
  syncNow: () => invoke<SyncStatus>("sync_now"),
  /** C'è dell'audio conservato per l'affinamento online di questo meeting? */
  keptAudio: (meetingId: string) => invoke<boolean>("kept_audio", { meetingId }),
  discardAudio: (meetingId: string) => invoke<void>("discard_audio", { meetingId }),
  /** Carica l'audio su Gladia e sostituisce la trascrizione con quella online, con i parlanti. */
  refineTranscript: (meetingId: string) => invoke<TranscriptSegment[]>("refine_transcript", { meetingId }),
  /** Più persone allo stesso microfono: da adesso parla `name` ("me" = tu). */
  setSpeaker: (meetingId: string, name: string) => invoke<void>("set_speaker", { meetingId, name }),
  /** Attribuisce parti già trascritte a un parlante ("me" = tu); ritorna la trascrizione aggiornata. */
  assignSpeaker: (meetingId: string, ids: number[], name: string) =>
    invoke<TranscriptSegment[]>("assign_speaker", { meetingId, ids, name }),
  /** Dà un nome a un parlante riconosciuto dall'affinamento online. */
  renameSpeaker: (meetingId: string, from: string, to: string) =>
    invoke<TranscriptSegment[]>("rename_speaker", { meetingId, from, to }),
  /** Segna i segmenti come "da verificare" o li libera; ritorna la trascrizione aggiornata. */
  reviewTranscript: (meetingId: string, ids: number[], review: boolean) =>
    invoke<TranscriptSegment[]>("review_transcript", { meetingId, ids, review }),

  /** Quanti meeting di esempio sono caricati. */
  demoStatus: () => invoke<number>("demo_status"),
  /** Carica i meeting di esempio; ritorna quanti sono. */
  loadDemo: () => invoke<number>("load_demo"),
  /** Toglie i meeting di esempio; ritorna quanti ne ha tolti. */
  removeDemo: () => invoke<number>("remove_demo"),
  listProjects: () => invoke<Project[]>("list_projects"),
  /** Crea un progetto (senza `id`) o ne cambia nome, colore e descrizione. */
  saveProject: (project: { id?: string; name: string; color: string; description: string }) =>
    invoke<Project>("save_project", project),
  /** Archivia un progetto chiuso (true) o lo riporta tra quelli attivi (false). */
  archiveProject: (id: string, archived: boolean) => invoke<Project[]>("archive_project", { id, archived }),
  /** Elimina un progetto: i suoi meeting restano, senza progetto. */
  deleteProject: (id: string) => invoke<Project[]>("delete_project", { id }),
  /** Mette i meeting in un progetto, o li toglie dal loro (null). */
  setMeetingsProject: (ids: string[], projectId: string | null) =>
    invoke<void>("set_meetings_project", { ids, projectId }),
  /** Apre la stampa di sistema sulla finestra (da lì si salva anche in PDF). */
  printWindow: () => invoke<void>("print_window"),
  /** Aggiunge e toglie tag a più meeting insieme. */
  tagMeetings: (ids: string[], add: string[], remove: string[]) =>
    invoke<void>("tag_meetings", { ids, add, remove }),
  /** Decisioni, azioni e citazioni di tutti i meeting, lette dalle note. */
  listItems: () => invoke<LibraryItem[]>("list_items"),
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
  /** A che punto del meeting (ms) è la registrazione dal vivo; null se lì non si registra. */
  recordingPosition: (meetingId: string) => invoke<number | null>("recording_position", { meetingId }),
  /** Fa scrivere all'AI cosa si diceva nei momenti segnati (ms). Torna solo quelli con una trascrizione. */
  fillMoments: (meetingId: string, moments: number[]) =>
    invoke<{ ms: number; text: string }[]>("fill_moments", { meetingId, moments }),

  enhanceNotes: (meetingId: string, streamId: string) =>
    invoke<string>("enhance_notes", { meetingId, streamId }),
  /** Una richiesta dell'editor all'AI: domanda sul meeting, blocco da creare, testo da riscrivere, schizzo. */
  aiAssist: (request: {
    meetingId: string | null;
    kind: "answer" | "block" | "rewrite" | "sketch" | "title";
    instruction: string;
    current?: string;
    format?: string;
    image?: string;
  }) => invoke<string>("ai_assist", { request }),
  /** Comincia ad ascoltare il microfono per dettare una richiesta. */
  dictationStart: () => invoke<void>("dictation_start"),
  /** Ferma la dettatura e ritorna il testo, trascritto in locale. `discard`: butta via l'audio. */
  dictationStop: (discard: boolean) => invoke<string>("dictation_stop", { discard }),
  getChat: (scope: string) => invoke<ChatMessage[]>("get_chat", { scope }),
  clearChat: (scope: string) => invoke<void>("clear_chat", { scope }),
  chat: (scope: string, question: string, streamId: string) =>
    invoke<ChatMessage>("chat", { scope, question, streamId }),
  cancelStream: (streamId: string) => invoke<void>("cancel_stream", { streamId }),

  listTemplates: () => invoke<Template[]>("list_templates"),
  saveTemplate: (template: Template) => invoke<Template>("save_template", { template }),
  deleteTemplate: (id: string) => invoke<void>("delete_template", { id }),
  /** L'AI propone i campi di un template descritto a parole, partendo da quello in modifica. Non salva. */
  draftTemplate: (request: string, template: Template) =>
    invoke<TemplateDraft>("draft_template", { request, template }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  /** Chiude (o riapre) la scheda dei dati di esempio nella Home. */
  setDemoCardHidden: (hidden: boolean) => invoke<void>("set_demo_card_hidden", { hidden }),
  hasApiKey: (providerId: string) => invoke<boolean>("has_api_key", { providerId }),
  setApiKey: (providerId: string, key: string) => invoke<void>("set_api_key", { providerId, key }),
  aiReady: () => invoke<boolean>("ai_ready"),
  /** Come macOS mostra l'ora: una scelta forzata, oppure lingua e regione da cui ricavarla. */
  systemTimeFormat: () => invoke<{ hour12: boolean | null; locale: string | null }>("system_time_format"),
  listProviderModels: (provider: Provider) => invoke<string[]>("list_provider_models", { provider }),
  appInfo: () => invoke<AppInfo>("app_info"),
  /** Scrive un errore dell'interfaccia nel file di log dell'app. Non fallisce mai. */
  logError: (message: string) => {
    invoke<void>("log_frontend_error", { message }).catch(() => {});
  },

  listWhisperModels: () => invoke<WhisperModelInfo[]>("list_whisper_models"),
  downloadWhisperModel: (name: string) => invoke<void>("download_whisper_model", { name }),
  deleteWhisperModel: (name: string) => invoke<void>("delete_whisper_model", { name }),

  /** Copia tra gli allegati un file incollato o trascinato (contenuto in base64). */
  saveAttachment: (name: string, data: string) => invoke<Attachment>("save_attachment", { name, data }),
  /** Fa scegliere un file e lo copia tra gli allegati. null se la scelta viene annullata. */
  pickAttachment: (imagesOnly: boolean) => invoke<Attachment | null>("pick_attachment", { imagesOnly }),
  /** Un'immagine allegata come data URL, da mostrare nell'editor. */
  readAttachment: (path: string) => invoke<string>("read_attachment", { path }),
  openAttachment: (path: string) => invoke<void>("open_attachment", { path }),
  /** Il titolo della pagina a quell'indirizzo, per le anteprime dei link. */
  linkTitle: (url: string) => invoke<string | null>("link_title", { url }),

  upcomingEvents: (force = false) => invoke<CalendarOverview>("upcoming_events", { force }),
  /** Mostra o nasconde un calendario in un vault (di base quello aperto). */
  showCalendarInVault: (calendar: string, shown: boolean, vault?: string) =>
    invoke<Vault[]>("show_calendar_in_vault", { calendar, shown, vault: vault ?? null }),
};

/** Un file copiato tra gli allegati: `path` è relativo alla cartella dati (attachments/…). */
export interface Attachment {
  path: string;
  name: string;
  size: number;
}

/** Mostra un avviso da un punto dell'app che non ha accesso ai toast (es. un plugin dell'editor). */
export function notify(text: string) {
  window.dispatchEvent(new CustomEvent<string>("granello:notify", { detail: text }));
}

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
  /** Sono arrivate modifiche da un altro dispositivo: gli id dei meeting toccati. */
  "vault-synced": string[];
  "meeting-starting": CalendarEvent;
};

export function on<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): () => void {
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
