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
  groups: unknown[];
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

// file inventati per Libreria → File: allegati dei primi meeting e file arrivati da un import
const day = 86_400_000;
let files = [
  { of: 0, name: lang === "it" ? "preventivo-v2.pdf" : "quote-v2.pdf", bytes: 248_000 },
  { of: 1, name: lang === "it" ? "schema-architettura.png" : "architecture-sketch.png", bytes: 412_000 },
  { of: 2, name: "roadmap.xlsx", bytes: 61_000 },
  {
    of: -1,
    name: lang === "it" ? "contratto-quadro-2024.pdf" : "framework-contract-2024.pdf",
    bytes: 1_300_000,
  },
  { of: -1, name: lang === "it" ? "verbale-assemblea.docx" : "general-meeting-minutes.docx", bytes: 38_000 },
]
  .filter((f) => f.of < 0 || titled[f.of])
  .map((f, i) => ({
    id: f.of < 0 ? `sciolto-${i}` : `${titled[f.of].id}:attachments/f${i}`,
    path: `attachments/f${i}.${f.name.split(".").pop()}`,
    name: f.name,
    bytes: f.bytes,
    meetingId: f.of < 0 ? null : titled[f.of].id,
    meetingTitle: f.of < 0 ? null : titled[f.of].title,
    folder: f.of < 0 ? (lang === "it" ? "Archivio" : "Archive") : null,
    at: f.of < 0 ? Date.now() - 3 * day : titled[f.of].createdAt,
    missing: false,
  }));
const importSummary = {
  obsidian: true,
  notes: 42,
  attachments: 17,
  loose: 2,
  projects:
    lang === "it"
      ? ["Clienti", "Clienti › Nord", "Personale", "Team"]
      : ["Clients", "Clients › Nord", "Personal", "Team"],
  already: 0,
  changed: [],
  missingLinks: 3,
  skipped: [
    {
      path: "Templates/",
      reason: lang === "it" ? "cartella dei template di Obsidian" : "Obsidian templates folder",
    },
    {
      path: lang === "it" ? "Mappe/progetto.canvas" : "Maps/project.canvas",
      reason: lang === "it" ? "canvas di Obsidian" : "Obsidian canvas",
    },
  ],
};
let imports: unknown[] = [];

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
    heldBy: null as string | null,
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

interface PreviewPerson {
  id: number;
  name: string;
  email: string | null;
  role: string;
  aliases: string[];
  meetings: number;
  lastMeetingAt: number | null;
}

/** Come in backend: minuscolo, senza accenti né punteggiatura, parole in ordine. */
const nameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .toSorted()
    .join(" ");

/** «E. Rossi» e «Elena Rossi». */
function initialOf(short: string, long: string) {
  const s = nameKey(short).split(" ");
  const l = nameKey(long).split(" ");
  if (s.length !== 2 || l.length !== 2) return false;
  const [initial, surname] = s[0].length === 1 ? [s[0], s[1]] : s[1].length === 1 ? [s[1], s[0]] : ["", ""];
  return (
    !!initial &&
    surname.length > 1 &&
    l.includes(surname) &&
    l.some((w) => w !== surname && w.startsWith(initial))
  );
}

/** Altri nomi puliti, senza doppioni e senza il nome stesso. */
const cleanAliases = (list: string[], name: string) => [
  ...new Map(
    list
      .map((a) => a.trim())
      .filter((a) => a && a.toLowerCase() !== name.toLowerCase())
      .map((a) => [a.toLowerCase(), a]),
  ).values(),
];
const people = () => data.people as PreviewPerson[];

interface PreviewGroup {
  id: string;
  name: string;
  color: string;
  description: string;
  parentId: string | null;
  kind: "team" | "audience";
  members: string[];
  emails: string[];
  meetings: number;
  lastMeetingAt: number | null;
}
const groups = () => data.groups as PreviewGroup[];
const byName = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name);

/** Un nome cambiato (o tolto, `to` = null) nella rubrica arriva tra i membri dei gruppi. */
function renameMember(from: string, to: string | null) {
  for (const g of groups()) {
    const list = g.members.flatMap((x) => (x.toLowerCase() === from.toLowerCase() ? (to ? [to] : []) : [x]));
    g.members = [...new Set(list)];
  }
}

/** Le persone che entrano in un gruppo entrano anche in rubrica. */
function addPeopleNamed(names: string[]) {
  for (const name of names) {
    if (people().some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
    const id = Math.max(0, ...people().map((p) => p.id)) + 1;
    data.people = [
      ...people(),
      { id, name, email: null, role: "", aliases: [], meetings: 0, lastMeetingAt: null },
    ].toSorted(byName);
  }
}

/** Le note che usano un gruppo, contate di nuovo dopo una modifica. */
function recountGroups() {
  const metas = data.meetings as { groupIds: string[]; createdAt: number }[];
  data.groups = groups().map((g) => {
    const used = metas.filter((m) => m.groupIds.includes(g.id));
    return {
      ...g,
      meetings: used.length,
      lastMeetingAt: used.length ? Math.max(...used.map((m) => m.createdAt)) : null,
    };
  });
}
let contactsAccess = "notDetermined";

/** Un nome cambiato nella rubrica arriva tra i partecipanti dei meeting. */
function renameAttendee(from: string, to: string) {
  const fix = (m: { attendees: string[] }) => {
    m.attendees = [...new Set(m.attendees.map((x) => (x.toLowerCase() === from.toLowerCase() ? to : x)))];
  };
  (data.meetings as { attendees: string[] }[]).forEach(fix);
  for (const d of Object.values(data.details) as { meeting: { attendees: string[] } }[]) fix(d.meeting);
  data.meetings = [...data.meetings];
}

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  // la ricerca dell'anteprima guarda solo titolo e tag, ma filtra davvero. Come quella vera
  // mette prima i più pertinenti (qui: chi ha la parola nel titolo), non i più recenti
  list_meetings: (a) => {
    const q = String(a.query ?? "")
      .trim()
      .toLowerCase();
    if (!q) return data.meetings;
    const inTitle = (m: { title: string }) => m.title.toLowerCase().includes(q);
    return (data.meetings as { title: string; tags: string[] }[])
      .filter((m) => inTitle(m) || m.tags.some((tag) => tag.includes(q)))
      .toSorted((x, y) => Number(inTitle(y)) - Number(inTitle(x)))
      .map((m) => ({ ...m, snippet: `«${m.title}»` }));
  },
  get_meeting: (a) => data.details[a.id as string],
  list_tags: () => data.tags,
  list_people: () => data.people,
  list_projects: () => data.projects,
  // i gruppi si scrivono davvero, in memoria, come i progetti
  list_groups: () => data.groups,
  save_group: (a) => {
    const name = String(a.name).trim();
    if (groups().some((g) => g.id !== a.id && g.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Esiste già un gruppo con il nome «${name}». Scegline un altro.`);
    const before = groups().find((g) => g.id === a.id);
    const saved: PreviewGroup = {
      id: (a.id as string) || `anteprima-gruppo-${Date.now()}`,
      name,
      color: String(a.color ?? ""),
      description: String(a.description ?? ""),
      parentId: (a.parentId as string | null) || null,
      kind: a.kind === "audience" ? "audience" : "team",
      members: a.members as string[],
      emails: (a.emails as string[] | undefined) ?? before?.emails ?? [],
      meetings: before?.meetings ?? 0,
      lastMeetingAt: before?.lastMeetingAt ?? null,
    };
    addPeopleNamed(saved.members);
    data.groups = [...groups().filter((g) => g.id !== saved.id), saved].toSorted(byName);
    return saved;
  },
  change_group_members: (a) => {
    const g = groups().find((x) => x.id === a.id)!;
    const remove = (a.remove as string[]).map((x) => x.toLowerCase());
    const kept = g.members.filter((m) => !remove.includes(m.toLowerCase()));
    const add = (a.add as string[]).filter((n) => !kept.some((m) => m.toLowerCase() === n.toLowerCase()));
    addPeopleNamed(add);
    const saved = { ...g, members: [...kept, ...add] };
    data.groups = groups().map((x) => (x.id === g.id ? saved : x));
    return saved;
  },
  delete_group: (a) => {
    const gone = groups().find((g) => g.id === a.id);
    data.groups = groups()
      .filter((g) => g.id !== a.id)
      .map((g) => (g.parentId === a.id ? { ...g, parentId: gone?.parentId ?? null } : g));
    const clear = (m: { groupIds: string[] }) => {
      m.groupIds = m.groupIds.filter((id) => id !== a.id);
    };
    (data.meetings as { groupIds: string[] }[]).forEach(clear);
    for (const d of Object.values(data.details) as { meeting: { groupIds: string[] } }[]) clear(d.meeting);
    data.meetings = [...data.meetings];
    return data.groups;
  },
  // partecipanti, gruppi e tag di una nota cambiano davvero, in memoria
  update_meeting_meta: (a) => {
    const detail = data.details[a.id as string] as {
      meeting: { id: string; attendees: string[]; groupIds: string[]; tags: string[] };
    };
    const m = detail.meeting;
    if (a.attendees) {
      m.attendees = a.attendees as string[];
      addPeopleNamed(m.attendees);
    }
    if (a.groupIds) m.groupIds = a.groupIds as string[];
    if (a.tags) m.tags = a.tags as string[];
    data.meetings = (data.meetings as { id: string }[]).map((x) =>
      x.id === m.id ? { ...x, attendees: m.attendees, groupIds: m.groupIds, tags: m.tags } : x,
    );
    recountGroups();
    return m;
  },
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
    const all = data.projects as { id: string; name: string; archived: boolean; parentId: string | null }[];
    const name = String(a.name).trim();
    if (all.some((p) => p.id !== a.id && p.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`Esiste già un progetto con il nome «${name}». Scegline un altro.`);
    const saved = {
      id: (a.id as string) || `anteprima-${Date.now()}`,
      name,
      color: a.color,
      description: a.description,
      archived: all.find((p) => p.id === a.id)?.archived ?? false,
      parentId: (a.parentId as string | null) ?? null,
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
    const all = data.projects as { id: string; parentId: string | null }[];
    const gone = all.find((p) => p.id === a.id);
    // i sotto-progetti salgono di un livello
    data.projects = all
      .filter((p) => p.id !== a.id)
      .map((p) => (p.parentId === a.id ? { ...p, parentId: gone?.parentId ?? null } : p));
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
  save_settings: (a) => {
    data.settings = a.settings as Record<string, unknown>;
    return data.settings;
  },
  // rubrica: nomi e unioni cambiano davvero, così la pagina Persone si prova tutta
  delete_person: (a) => {
    const gone = people().find((p) => p.id === a.id);
    if (gone) renameMember(gone.name, null);
    data.people = people().filter((p) => p.id !== a.id);
    return null;
  },
  update_person: (a) => {
    const p = people().find((x) => x.id === a.id)!;
    const name = String(a.name).trim();
    if (people().some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`In rubrica c'è già «${name}»: per tenerne una sola usa Unisci.`);
    renameAttendee(p.name, name);
    renameMember(p.name, name);
    // il nome vecchio diventa uno degli altri nomi, come in backend
    const aliases = (a.aliases as string[] | undefined) ?? p.aliases ?? [];
    p.aliases = cleanAliases(p.name !== name ? [...aliases, p.name] : aliases, name);
    if (typeof a.role === "string") p.role = a.role.trim();
    p.name = name;
    p.email = (a.email as string | null) || null;
    return people();
  },
  merge_people: (a) => {
    const from = people().find((x) => x.id === a.from)!;
    const into = people().find((x) => x.id === a.into)!;
    renameAttendee(from.name, into.name);
    renameMember(from.name, into.name);
    into.meetings += from.meetings;
    into.email ??= from.email;
    into.role ||= from.role;
    into.aliases = cleanAliases([...(into.aliases ?? []), ...(from.aliases ?? []), from.name], into.name);
    into.lastMeetingAt = Math.max(into.lastMeetingAt ?? 0, from.lastMeetingAt ?? 0) || null;
    data.people = people().filter((x) => x.id !== from.id);
    return people();
  },
  contacts_access: () => contactsAccess,
  request_contacts_access: () => (contactsAccess = "authorized"),
  pick_vcard: () =>
    [
      ["Francesca Neri", "francesca.neri@example.ch"],
      ["Giorgio Testa", "giorgio@example.ch"],
      ["Elena Rossi", "elena.rossi@example.ch"],
      ["Studio Fontana", null],
    ].map(([name, email]) => ({
      name,
      email,
      known: people().some((p) => p.name.toLowerCase() === String(name).toLowerCase()),
    })),
  add_people: (a) => {
    for (const p of a.people as { name: string; email: string | null; role?: string; groups?: string[] }[]) {
      const known = people().find((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (known) {
        known.email ??= p.email;
        known.role ||= p.role ?? "";
      } else
        people().push({
          id: Date.now() + people().length,
          name: p.name,
          email: p.email,
          role: p.role ?? "",
          aliases: [],
          meetings: 0,
          lastMeetingAt: null,
        });
      // i gruppi della colonna Gruppo: si crea solo l'ultimo livello, che basta a provare la pagina
      for (const path of p.groups ?? []) {
        const leaf = path
          .split(/[/›>]/)
          .map((x) => x.trim())
          .filter(Boolean)
          .at(-1);
        if (!leaf) continue;
        let g = groups().find((x) => x.name.toLowerCase() === leaf.toLowerCase());
        if (!g) {
          g = {
            id: `anteprima-gruppo-${Date.now()}-${leaf}`,
            name: leaf,
            color: "",
            description: "",
            parentId: null,
            kind: "team",
            members: [],
            emails: [],
            meetings: 0,
            lastMeetingAt: null,
          };
          data.groups = [...groups(), g].toSorted(byName);
        }
        if (!g.members.some((m) => m.toLowerCase() === p.name.toLowerCase()))
          g.members = [...g.members, p.name];
      }
    }
    data.people = people().toSorted((x, y) => x.name.localeCompare(y.name));
    return people();
  },
  // le coppie che sembrano la stessa persona, con le regole del backend
  possible_duplicates: () => {
    const list = people();
    const out: { keep: number; drop: number; reason: string }[] = [];
    list.forEach((a, i) =>
      list.slice(i + 1).forEach((b) => {
        const reason =
          a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()
            ? "email"
            : nameKey(a.name) === nameKey(b.name)
              ? "name"
              : initialOf(a.name, b.name) || initialOf(b.name, a.name)
                ? "initial"
                : null;
        if (!reason) return;
        const [keep, drop] = b.meetings > a.meetings ? [b, a] : [a, b];
        out.push({ keep: keep.id, drop: drop.id, reason });
      }),
    );
    return out;
  },
  fill_emails_from_contacts: () => {
    const missing = people().filter((p) => !p.email);
    for (const p of missing) p.email = `${p.name.toLowerCase().replace(/\s+/g, ".")}@example.ch`;
    data.people = [...people()];
    return missing.length;
  },
  // i vault vivono in memoria: serve a provare la sezione delle impostazioni e il selettore
  list_vaults: () => vaults,
  // la seconda cartella è di un vault aperto su un altro computer, per provare quello stato
  pick_vault_dir: () => (vaults.length > 1 ? "/Volumes/Condiviso/Granello" : "/Volumes/Cifrato/Granello"),
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
        heldBy: String(a.path).includes("Condiviso") ? "Portatile di Anna" : null,
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
    const held = vaults.find((v) => v.id === a.id)?.heldBy;
    if (held && !a.force)
      throw new Error(
        `Questo vault risulta aperto su «${held}». Chiudi Granello su quel computer e riprova.`,
      );
    vaults = vaults.map((v) => ({
      ...v,
      active: v.id === a.id,
      heldBy: v.id === a.id ? null : v.heldBy,
    }));
    return vaults;
  },
  // il sync vive in memoria: serve a vedere la sezione nelle impostazioni
  sync_status: () => ({ ...sync, available: Boolean(data.settings.developerPreviews) }),
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
  list_files: () => files,
  delete_file: (a) => {
    files = files.filter((f) => f.id !== a.id);
    return null;
  },
  pick_import_dir: () => "/Users/anteprima/Documents/Obsidian/Vault",
  scan_obsidian: async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return importSummary;
  },
  import_obsidian: (a) => {
    const rec = {
      id: `import-${Date.now()}`,
      source: "obsidian",
      root: a.dir,
      createdAt: Date.now(),
      notes: importSummary.notes,
      files: importSummary.loose,
      report: importSummary,
    };
    imports = [rec, ...imports];
    return rec;
  },
  list_imports: () => imports,
  undo_import: (a) => {
    imports = imports.filter((i) => (i as { id: string }).id !== a.id);
    return importSummary.notes;
  },
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
  // due eventi inventati per provare le proposte dei gruppi: un invito alla mailing list
  // dell'azienda e uno con tanti invitati
  calendar_match: (a) => {
    const base = {
      location: null,
      meetingId: a.meetingId,
      calendarId: "lavoro",
      start: Date.now(),
      end: Date.now() + 3600_000,
    };
    if (a.meetingId === "demo-offsite")
      return {
        ...base,
        id: "anteprima-offsite",
        title: "Offsite",
        attendees: ["Elena Rossi"],
        emails: ["elena@example.ch", "tutti@example.ch"],
      };
    if (a.meetingId === "demo-budget")
      return {
        ...base,
        id: "anteprima-convention",
        title: lang === "it" ? "Convention di primavera" : "Spring convention",
        attendees: Array.from({ length: 20 }, (_, i) => `${lang === "it" ? "Ospite" : "Guest"} ${i + 1}`),
        emails: [],
      };
    return null;
  },
  // le proposte dei partecipanti cercano nella rubrica, come quelle vere (senza calendario né Mac)
  suggest_people: (a) => {
    const q = String(a.query ?? "")
      .trim()
      .toLowerCase();
    return people()
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({ name: p.name, email: p.email, source: "people" }));
  },
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
