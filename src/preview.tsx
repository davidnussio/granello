// Anteprima dell'interfaccia nel browser, senza backend Tauri: i comandi rispondono
// con i meeting di esempio generati dal database vero (`pnpm preview`, vedi
// src-tauri/src/preview.rs). Serve per provare le modifiche all'interfaccia e per le
// schermate della vetrina. Non entra nella build dell'app.
//
// Parametri: ?lang=it|en, ?rec (il primo meeting è in registrazione)
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

interface Fixtures {
  settings: Record<string, unknown>;
  meetings: unknown[];
  details: Record<string, unknown>;
  tags: unknown[];
  people: unknown[];
  projects: unknown[];
  items: unknown[];
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
// per le schermate gli eventi sono domani: la Home li mostra a qualunque ora si scatti
const hour = (h: number) => {
  const d = new Date();
  if (params.has("shots")) d.setDate(d.getDate() + 1);
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

// registrazioni inventate (senza audio vero) per i primi due meeting: tre e una
const titled = data.meetings as { id: string; title: string; createdAt: number }[];
let recordings = [
  { of: 0, after: 0, durationMs: 129_000, bytes: 820_000, trimmed: true },
  { of: 0, after: 14, durationMs: 20_000, bytes: 130_000, trimmed: false },
  { of: 0, after: 16, durationMs: 12_000, bytes: 90_000, trimmed: false },
  { of: 1, after: 0, durationMs: 2_520_000, bytes: 15_400_000, trimmed: false },
]
  .filter((r) => titled[r.of])
  .map((r, i) => ({
    id: i + 1,
    meetingId: titled[r.of].id,
    meetingTitle: titled[r.of].title,
    path: `/anteprima/registrazione-${i + 1}.m4a`,
    startedAt: titled[r.of].createdAt + r.after * 60_000,
    durationMs: r.durationMs,
    bytes: r.bytes,
    trimmed: r.trimmed,
  }))
  .toReversed();
// una forma d'onda finta ma sempre uguale per la stessa registrazione
const fakeWave = (id: number) =>
  Array.from({ length: 160 }, (_, i) => {
    const speech = Math.sin(i / (5 + id)) * Math.sin(i / 2.3 + id) * Math.sin(i * 1.7 + id * 3);
    return Math.round(Math.abs(speech) ** 0.6 * 255 * (Math.sin(i / 23 + id) > -0.6 ? 1 : 0.05));
  });

// nell'anteprima c'è solo il vault principale; quelli aggiunti si perdono ricaricando
let vaults = [
  {
    id: "main",
    name: lang === "it" ? "Principale" : "Main",
    path: "/Users/anteprima/Library/Application Support/ch.dambox.granello",
    minPrivacy: "open",
    main: true,
    active: true,
    available: true,
    hiddenCalendars: [] as string[],
  },
];

let sync = {
  available: true,
  blocked: null,
  dir: null as string | null,
  lastSync: null as number | null,
  devices: 0,
  pending: 0,
  conflicts: 0,
  error: null,
};

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_meetings: () => data.meetings,
  get_meeting: (a) => data.details[a.id as string],
  list_tags: () => data.tags,
  list_people: () => data.people,
  list_projects: () => data.projects,
  list_items: () => data.items,
  print_window: () => window.print(),
  // l'unica scrittura che l'anteprima esegue davvero: serve a provare i tag su più meeting
  tag_meetings: (a) => {
    const ids = a.ids as string[];
    const retag = (m: { id: string; tags: string[] }) => {
      if (!ids.includes(m.id)) return;
      const kept = m.tags.filter((tag) => !(a.remove as string[]).includes(tag));
      m.tags = [...kept, ...(a.add as string[]).filter((tag) => !kept.includes(tag))];
    };
    (data.meetings as { id: string; tags: string[] }[]).forEach(retag);
    for (const d of Object.values(data.details) as { meeting: { id: string; tags: string[] } }[])
      retag(d.meeting);
    data.meetings = [...data.meetings];
    return null;
  },
  // anche i progetti si scrivono davvero, in memoria: serve a provare la finestra e gli spostamenti
  save_project: (a) => {
    const all = data.projects as { id: string; name: string; archived: boolean }[];
    const name = String(a.name).trim();
    if (all.some((p) => p.id !== a.id && p.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Esiste già un progetto con il nome «${name}». Scegline un altro.`);
    const saved = {
      id: (a.id as string) || `anteprima-${Date.now()}`,
      name,
      color: a.color,
      description: a.description,
      archived: all.find((p) => p.id === a.id)?.archived ?? false,
    };
    data.projects = [...all.filter((p) => p.id !== saved.id), saved].toSorted((x, y) =>
      x.name.localeCompare(y.name),
    );
    return saved;
  },
  archive_project: (a) => {
    data.projects = (data.projects as { id: string }[]).map((p) =>
      p.id === a.id ? { ...p, archived: a.archived } : p,
    );
    return data.projects;
  },
  delete_project: (a) => {
    data.projects = (data.projects as { id: string }[]).filter((p) => p.id !== a.id);
    const clear = (m: { projectId: string | null }) => {
      if (m.projectId === a.id) m.projectId = null;
    };
    (data.meetings as { projectId: string | null }[]).forEach(clear);
    for (const d of Object.values(data.details) as { meeting: { projectId: string | null } }[])
      clear(d.meeting);
    data.meetings = [...data.meetings];
    return data.projects;
  },
  set_meetings_project: (a) => {
    const ids = a.ids as string[];
    const move = (m: { id: string; projectId: string | null }) => {
      if (ids.includes(m.id)) m.projectId = (a.projectId as string | null) ?? null;
    };
    (data.meetings as { id: string; projectId: string | null }[]).forEach(move);
    for (const d of Object.values(data.details) as { meeting: { id: string; projectId: string | null } }[])
      move(d.meeting);
    data.meetings = [...data.meetings];
    return null;
  },
  set_meetings_pinned: (a) => {
    const ids = a.ids as string[];
    const now = Date.now();
    const pin = (m: { id: string; pinnedAt: number | null }) => {
      if (!ids.includes(m.id)) return;
      if (!a.pinned) m.pinnedAt = null;
      else m.pinnedAt ??= now + ids.indexOf(m.id);
    };
    (data.meetings as { id: string; pinnedAt: number | null }[]).forEach(pin);
    for (const d of Object.values(data.details) as { meeting: { id: string; pinnedAt: number | null } }[])
      pin(d.meeting);
    data.meetings = [...data.meetings];
    return null;
  },
  // i vault vivono in memoria: serve a provare la sezione delle impostazioni e il selettore
  list_vaults: () => vaults,
  pick_vault_dir: () => "/Volumes/Cifrato/Granello",
  create_vault: (a) => {
    const name = String(a.name).trim();
    if (vaults.some((v) => v.path === a.path))
      throw new Error("Quella cartella è già un vault. Scegline un'altra.");
    vaults = [
      ...vaults,
      {
        id: `anteprima-${Date.now()}`,
        name,
        path: a.path as string,
        minPrivacy: a.minPrivacy as string,
        main: false,
        active: false,
        available: true,
        hiddenCalendars: [],
      },
    ];
    return vaults;
  },
  update_vault: (a) => {
    vaults = vaults.map((v) =>
      v.id === a.id
        ? { ...v, name: v.main ? v.name : String(a.name), minPrivacy: a.minPrivacy as string }
        : v,
    );
    return vaults;
  },
  remove_vault: (a) => {
    vaults = vaults.filter((v) => v.id !== a.id);
    return vaults;
  },
  show_calendar_in_vault: (a) => {
    const vault = (a.vault as string | null) ?? vaults.find((v) => v.active)?.id;
    vaults = vaults.map((v) =>
      v.id === vault
        ? {
            ...v,
            hiddenCalendars: [
              ...v.hiddenCalendars.filter((c) => c !== a.calendar),
              ...(a.shown ? [] : [a.calendar as string]),
            ],
          }
        : v,
    );
    return vaults;
  },
  open_vault: (a) => {
    vaults = vaults.map((v) => ({ ...v, active: v.id === a.id }));
    return vaults;
  },
  // il sync vive in memoria: serve a vedere la sezione nelle impostazioni
  sync_status: () => sync,
  pick_sync_dir: () => "/Users/anteprima/Library/Mobile Documents/com~apple~CloudDocs/Granello",
  enable_sync: (a) => {
    sync = { ...sync, dir: a.dir as string, lastSync: Date.now(), devices: 1 };
    return sync;
  },
  disable_sync: () => {
    sync = { ...sync, dir: null, lastSync: null, devices: 0 };
    return sync;
  },
  sync_now: () => {
    sync = { ...sync, lastSync: Date.now() };
    return sync;
  },
  list_templates: () => data.templates,
  // i template si possono salvare davvero, in memoria: serve a provare le note di partenza
  save_template: (a) => {
    const tpl = a.template as { id: string; builtin: boolean };
    const saved = { ...tpl, id: tpl.id && !tpl.builtin ? tpl.id : `anteprima-${Date.now()}`, builtin: false };
    data.templates = [...(data.templates as { id: string }[]).filter((x) => x.id !== saved.id), saved];
    return saved;
  },
  // proposta finta dell'AI per il campo "Configura con l'AI" dei template
  draft_template: async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return lang === "it"
      ? {
          name: "Retro di sprint",
          description: "Retrospettiva a fine sprint con il team",
          instructions:
            "Usa queste sezioni:\n### Cosa è andato bene\n### Cosa migliorare\n### Azioni\nNelle azioni indica responsabile e scadenza quando sono dette. Salta le sezioni vuote.",
          notesMd:
            "## Cosa è andato bene\n\n- \n\n## Cosa migliorare\n\n- \n\n## Azioni\n\n- [ ] Chi: cosa, entro quando",
        }
      : {
          name: "Sprint retro",
          description: "End-of-sprint retrospective with the team",
          instructions:
            "Use these sections:\n### What went well\n### What to improve\n### Action items\nFor action items, give owner and due date when stated. Skip empty sections.",
          notesMd:
            "## What went well\n\n- \n\n## What to improve\n\n- \n\n## Action items\n\n- [ ] Who: what, by when",
        };
  },
  get_settings: () => data.settings,
  set_demo_card_hidden: (a) => {
    data.settings = { ...(data.settings as object), hideDemoCard: a.hidden };
  },
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
  // ?rec: il primo meeting risulta in registrazione, per vedere la barra con i suoi comandi
  recording_status: () => ({
    meetingId: params.has("rec") ? (data.meetings as { id: string }[])[0].id : null,
    recording: params.has("rec"),
    importing: false,
    pendingChunks: 0,
  }),
  // il minuto della registrazione simulata: momenti e citazioni dal menu "/" lo prendono da qui
  recording_position: () => (params.has("rec") ? 125_000 : null),
  recordings_info: () => ({ dir: "", defaultDir: "", ffmpeg: true }),
  list_recordings: (a) => recordings.filter((r) => !a.meetingId || r.meetingId === a.meetingId),
  recording_waveform: (a) => fakeWave(a.id as number),
  delete_recording: (a) => {
    recordings = recordings.filter((r) => r.id !== a.id);
    return null;
  },
  trim_recording: (a) => {
    recordings = recordings.map((r) =>
      r.id === a.id
        ? { ...r, trimmed: true, durationMs: Math.round(r.durationMs * 0.8), bytes: r.bytes - 1 }
        : r,
    );
    return recordings;
  },
  merge_recordings: (a) => {
    const parts = recordings.filter((r) => r.meetingId === a.meetingId).toReversed();
    const merged = {
      ...parts[0],
      durationMs: parts.reduce((ms, r) => ms + r.durationMs, 0),
      bytes: parts.reduce((n, r) => n + r.bytes, 0),
      trimmed: parts.some((r) => r.trimmed),
    };
    recordings = recordings.filter((r) => r.meetingId !== a.meetingId || r.id === merged.id);
    recordings = recordings.map((r) => (r.id === merged.id ? merged : r));
    return null;
  },
  list_audio_devices: () => ["MacBook Pro Microphone"],
  get_chat: () => [],
  kept_audio: () => false,
  calendar_match: () => null,
  suggest_people: () => [],
  upcoming_events: () => {
    // la scelta del vault aperto vale anche qui
    const shown = !vaults.find((v) => v.active)?.hiddenCalendars.includes("lavoro");
    return {
      calendars: [
        { id: "lavoro", name: lang === "it" ? "Lavoro" : "Work", enabled: true, shown, error: null },
      ],
      events: (shown ? events : []).map((e, i) => ({
        id: `evento-${i}`,
        title: e.title,
        start: hour(e.h),
        end: hour(e.h + 1),
        attendees: e.attendees,
        location: null,
        meetingId: null,
        calendarId: "lavoro",
      })),
    };
  },
};

mockWindows("main");
mockConvertFileSrc("macos");
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
