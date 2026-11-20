// Anteprima dell'interfaccia nel browser, senza backend Tauri: i comandi rispondono
// con i meeting di esempio generati dal database vero (`pnpm preview`, vedi
// src-tauri/src/preview.rs). Serve per provare le modifiche all'interfaccia e per le
// schermate della vetrina. Non entra nella build dell'app.
//
// Parametri: ?lang=it|en
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

interface Fixtures {
  settings: Record<string, unknown>;
  meetings: unknown[];
  details: Record<string, unknown>;
  tags: unknown[];
  people: unknown[];
  projects: unknown[];
  templates: unknown[];
  demoCount: number;
  whisperModels: { name: string; downloaded: boolean }[];
}

const params = new URLSearchParams(location.search);
const lang = params.get("lang") === "en" ? "en" : "it";

const response = await fetch(`/preview/fixtures/${lang}.json`);
if (!response.ok) {
  document.body.textContent = "Dati dell'anteprima mancanti: lancia `pnpm preview`.";
  throw new Error("fixtures");
}
const data = (await response.json()) as Fixtures;

// per le schermate (?shots) i meeting di esempio non mostrano il tag #faker
const strip = (tags: string[]) => tags.filter((tag) => tag !== "faker");
if (params.has("shots")) {
  for (const m of data.meetings as { tags: string[] }[]) m.tags = strip(m.tags);
  for (const d of Object.values(data.details) as { meeting: { tags: string[] } }[]) {
    d.meeting.tags = strip(d.meeting.tags);
  }
  data.tags = (data.tags as { name: string }[]).filter((t) => t.name !== "faker");
}

// il modello consigliato risulta scaricato, così la Home non segnala passi mancanti
const whisperModels = data.whisperModels.map((m, i) => ({ ...m, downloaded: i === 0 || m.downloaded }));
if (whisperModels.length) data.settings.whisperModel = whisperModels[0].name;

// due eventi inventati in calendario per oggi
const hour = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.getTime();
};
const events =
  lang === "it"
    ? [
        { title: "Revisione del preventivo", attendees: ["Giulia Ferri", "Marco Bianchi"], h: 15 },
        { title: "Allineamento settimanale", attendees: ["Elena Rossi"], h: 17 },
      ]
    : [
        { title: "Quote review", attendees: ["Giulia Ferri", "Marco Bianchi"], h: 15 },
        { title: "Weekly sync", attendees: ["Elena Rossi"], h: 17 },
      ];

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_meetings: () => data.meetings,
  get_meeting: (a) => data.details[a.id as string],
  list_tags: () => data.tags,
  list_people: () => data.people,
  list_projects: () => data.projects,
  list_templates: () => data.templates,
  get_settings: () => data.settings,
  demo_status: () => data.demoCount,
  list_whisper_models: () => whisperModels,
  ai_ready: () => true,
  has_api_key: () => true,
  app_info: () => ({
    version: "preview",
    dataDir: "~/Library/Application Support/ch.dambox.granello",
    logDir: "",
  }),
  system_time_format: () => ({ hour12: false, locale: lang === "it" ? "it-CH" : "en-GB" }),
  recording_status: () => ({ meetingId: null, recording: false, importing: false, pendingChunks: 0 }),
  recordings_info: () => ({ dir: "", defaultDir: "", ffmpeg: true }),
  list_recordings: () => [],
  list_audio_devices: () => ["MacBook Pro Microphone"],
  get_chat: () => [],
  kept_audio: () => false,
  calendar_match: () => null,
  suggest_people: () => [],
  upcoming_events: () => ({
    calendars: [{ id: "lavoro", name: lang === "it" ? "Lavoro" : "Work", enabled: true, error: null }],
    events: events.map((e, i) => ({
      id: `evento-${i}`,
      title: e.title,
      start: hour(e.h),
      end: hour(e.h + 1),
      attendees: e.attendees,
      location: null,
      meetingId: null,
      calendarId: "lavoro",
    })),
  }),
};

mockWindows("main");
mockIPC(
  (cmd, payload) => {
    const handler = handlers[cmd];
    if (handler) return handler((payload ?? {}) as Record<string, unknown>);
    // tutto il resto (scritture, AI, registrazione) non fa nulla nell'anteprima
    console.debug("anteprima: comando ignorato", cmd);
    return null;
  },
  { shouldMockEvents: true },
);

await import("./main");
