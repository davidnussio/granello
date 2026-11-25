import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { ItemKind, LibraryItem, Meeting, MeetingSummary, Project } from "../types";
import { dayLabel, mmss, time } from "../format";
import { locale, t } from "../i18n";
import { sparkle } from "../sparkles";
import Files from "./Files";
import ProjectDialog, { ProjectDot } from "./ProjectDialog";
import PinIcon from "./PinIcon";
import Menu from "./Menu";
import {
  archivedIn,
  projectBranch,
  projectOptions,
  projectPath,
  projectTitle,
  projectTree,
  tagLevels,
} from "../tree";

interface Props {
  projects: Project[];
  onProjectsChanged: (projects: Project[]) => void;
  onOpen: (meetingId: string) => void;
  /** Tag o progetto di qualche meeting sono cambiati: chi tiene un elenco di meeting lo ricarica. */
  onMeetingsChanged: () => void;
  toast: (text: string) => void;
  /** Apre la Libreria sui meeting di questa persona. */
  person?: string;
  /** Apre la Libreria su tutte le note (da «Tutte le note» nella barra laterale). */
  all?: boolean;
}

type Dim = "all" | "pinned" | "projects" | "people" | "tags" | "period" | "files";
/** Le dimensioni che raggruppano i meeting (i file no). */
type GroupDim = Exclude<Dim, "files">;
/**
 * Le dimensioni con una colonna di voci da scegliere: i fissati sono un filtro senza voci, tutte
 * le note nessun filtro.
 */
type FacetDim = Exclude<GroupDim, "pinned" | "all">;
const FACETS: FacetDim[] = ["projects", "people", "tags", "period"];
/**
 * Con più voci scelte nella stessa colonna, in persone e tag un meeting deve averle tutte (Ermanno
 * e Daniele insieme); in progetti e periodo ne basta una, perché un meeting ne ha una sola.
 */
const ALL_OF: ReadonlySet<FacetDim> = new Set(["people", "tags"]);

/** I tasti tenuti premuti durante un clic: Cmd aggiunge o toglie, Maiusc prende fino a lì. */
interface Mods {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** Un elemento con il suo meeting, pronto per l'elenco. */
interface Shown {
  id: number;
  item: LibraryItem;
  meeting: MeetingSummary;
}

const KINDS: { id: ItemKind; icon: string; label: () => string }[] = [
  { id: "decision", icon: "✓", label: () => t("Decisioni") },
  { id: "action", icon: "☐", label: () => t("Azioni") },
  { id: "quote", icon: "❝", label: () => t("Citazioni") },
];

/** Una voce della seconda colonna: un progetto, una persona, un tag o un periodo, con i suoi meeting. */
interface Group {
  key: string;
  /** Il nome completo: `progetto/bizcard`, o il nome del progetto. */
  label: string;
  /** Il nome nella colonna, sotto la voce che la contiene: `bizcard`. */
  short?: string;
  /** Le note della voce e di quelle che contiene. */
  meetings: MeetingSummary[];
  archived?: boolean;
  /** Solo nella dimensione dei progetti: il progetto di questa voce. */
  project?: Project;
  /** Progetti e tag con `/` stanno in un albero: la voce che contiene questa, e a che livello. */
  parent?: string;
  depth?: number;
}

const DIMS: { id: Dim; icon: React.ReactNode; label: () => string }[] = [
  // nessun filtro: tutte le note del vault, dalla più recente
  { id: "all", icon: "≡", label: () => t("Tutte le note") },
  // una voce sola, senza seconda colonna: i meeting fissati nella barra laterale
  { id: "pinned", icon: <PinIcon filled />, label: () => t("Fissati") },
  { id: "projects", icon: "▣", label: () => t("Progetti") },
  { id: "people", icon: "☺", label: () => t("Persone") },
  { id: "tags", icon: "#", label: () => t("Tag") },
  { id: "period", icon: "▦", label: () => t("Periodo") },
  // non raggruppa i meeting: mostra le registrazioni, gli allegati e i file senza nota
  { id: "files", icon: "▤", label: () => t("File") },
];

/** Maiusc + clic: aggiunge le voci di `range`, o le toglie se la voce cliccata era già scelta. */
function shiftRange<T>(now: T[], range: T[], remove: boolean): T[] {
  return remove ? now.filter((x) => !range.includes(x)) : [...new Set([...now, ...range])];
}

/** Raggruppa i meeting per una chiave multipla (tag, persone), dal gruppo più numeroso. */
function groupBy(meetings: MeetingSummary[], keys: (m: MeetingSummary) => string[]): Group[] {
  const map = new Map<string, Group>();
  for (const m of meetings) {
    for (const raw of keys(m)) {
      const key = raw.toLowerCase();
      const group = map.get(key) ?? { key, label: raw, meetings: [] };
      group.meetings.push(m);
      map.set(key, group);
    }
  }
  return [...map.values()].toSorted(
    (a, b) => b.meetings.length - a.meetings.length || a.label.localeCompare(b.label),
  );
}

/** Questa settimana, poi un gruppo per mese, dal più recente. */
function byPeriod(meetings: MeetingSummary[]): Group[] {
  const now = new Date();
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - ((now.getDay() + 6) % 7),
  ).getTime();
  const month = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" });
  const out: Group[] = [];
  const week = meetings.filter((m) => m.createdAt >= monday);
  if (week.length) out.push({ key: "week", label: t("Questa settimana"), meetings: week });
  const months = new Map<string, Group>();
  for (const m of meetings) {
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = month.format(d);
    const group = months.get(key) ?? {
      key,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      meetings: [],
    };
    group.meetings.push(m);
    months.set(key, group);
  }
  return [...out, ...[...months.values()].toSorted((a, b) => b.key.localeCompare(a.key))];
}

/**
 * I tag in albero: `progetto/bizcard` sta sotto `progetto`, che raccoglie le note di tutti i tag
 * che cominciano così (anche se nessuna nota porta `progetto` da solo).
 */
function tagTree(meetings: MeetingSummary[]): Group[] {
  const map = new Map<string, Group>();
  for (const m of meetings) {
    const levels = new Set(m.tags.flatMap((tag) => tagLevels(tag)));
    for (const raw of levels) {
      const key = raw.toLowerCase();
      const parts = raw.split("/");
      const group = map.get(key) ?? {
        key,
        label: raw,
        short: parts.at(-1),
        meetings: [],
        depth: parts.length - 1,
        parent: parts.length > 1 ? parts.slice(0, -1).join("/").toLowerCase() : undefined,
      };
      group.meetings.push(m);
      map.set(key, group);
    }
  }
  // ognuno seguito da quelli che contiene, in ordine alfabetico a ogni livello
  const kids = new Map<string | undefined, Group[]>();
  for (const g of map.values()) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g]);
  const out: Group[] = [];
  const walk = (parent: string | undefined) => {
    for (const g of (kids.get(parent) ?? []).toSorted((a, b) =>
      a.short!.localeCompare(b.short!, locale(), { sensitivity: "base" }),
    )) {
      out.push(g);
      walk(g.key);
    }
  };
  walk(undefined);
  return out;
}

/** Le voci di una dimensione, ognuna con i suoi meeting. */
function groupsOf(dim: FacetDim, meetings: MeetingSummary[], projects: Project[]): Group[] {
  // persone e tag in ordine alfabetico: filtrando cambiano i numeri, non il posto delle voci
  const byName = (groups: Group[]) =>
    groups.toSorted((a, b) => a.label.localeCompare(b.label, locale(), { sensitivity: "base" }));
  if (dim === "people") return byName(groupBy(meetings, (m) => m.attendees));
  if (dim === "period") return byPeriod(meetings);
  if (dim === "tags") return tagTree(meetings);
  // un progetto resta in elenco anche prima di avere meeting; uno che ne contiene altri raccoglie
  // anche le loro note
  return projectTree(projects).map(({ project: p, depth }) => {
    const branch = projectBranch(p.id, projects);
    return {
      key: p.id,
      label: p.name,
      meetings: meetings.filter((m) => m.projectId !== null && branch.has(m.projectId)),
      archived: archivedIn(p.id, projects),
      project: p,
      depth,
      parent: depth > 0 ? (p.parentId ?? undefined) : undefined,
    };
  });
}

/** Dove la Libreria ricorda i rami aperti, su questo Mac. */
const OPEN_KEY = "granello.library.open";

function readOpen(): ReadonlySet<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function saveOpen(open: ReadonlySet<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // senza memoria i rami si riaprono a mano: niente di grave
  }
}

const hash = (dim: FacetDim) => (dim === "tags" ? "#" : "");

/** Il testo di un elemento senza la sintassi Markdown: menzioni, date, link, evidenziatore. */
function plain(text: string): string {
  const day = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short" });
  return text
    .replace(/@\[([^\]]+)\]/g, "$1")
    .replace(/\[\[(\d{4})-(\d{2})-(\d{2})\]\]/g, (_, y, m, d) =>
      day.format(new Date(Number(y), Number(m) - 1, Number(d))),
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|==|`|\*/g, "");
}

/** Ciò che l'anteprima mostra di un meeting, ricavato dalle sue note. */
function digest(meeting: Meeting) {
  const md = (meeting.enhancedMd?.trim() || meeting.notesMd)
    // i blocchi fatti di dati (citazioni, sondaggi, lavagne…) si contano, non si leggono in anteprima
    .replace(
      /^[ \t>]*:{3,} *(quote|moment|poll|kanban|timeline|pros-cons|matrix)\b[\s\S]*?^[ \t>]*:{3,} *$/gm,
      "",
    );
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    // i blocchi dell'editor (::: …, recinti di codice, tabelle) non sono testo da leggere in anteprima
    .filter((l) => l && !/^(:{3,}|```|\||\[\[|!\[|\$\$)/.test(l))
    .map((l) =>
      l
        .replace(/^(#{1,6}|[-*+]|\d+\.|>)\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        // il segno di un callout (> [!WARNING]) non è testo
        .replace(/^\[![A-Z]+\]\s*/, "")
        .replace(/@\[([^\]]+)\]/g, "$1")
        .replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, "$1")
        // stelle, timer e gli altri blocchi in linea non si leggono come testo
        .replace(/\[\[[^\]]*\]\]/g, "")
        // una formula semplice si legge com'è, una in LaTeX non si legge in anteprima
        .replace(/\$([^$\\]+)\$/g, "$1")
        .replace(/\$[^$]*\$/g, "…")
        .replace(/==([^=]+)==(\{\.[a-z]+\})?/g, "$1")
        .replace(/\*\*|__|[*`]/g, "")
        .trim(),
    )
    .filter(Boolean);
  const all = `${meeting.notesMd}\n${meeting.enhancedMd ?? ""}`;
  const count = (re: RegExp) => (all.match(re) ?? []).length;
  return {
    text: lines.slice(0, 4).join(" · ").slice(0, 320),
    openTasks: count(/^\s*[-*] \[ \]/gm),
    quotes: count(/^[ \t>]*:{3,} *quote\b/gm),
    moments: count(/^[ \t>]*:{3,} *moment\b/gm),
  };
}

export default function LibraryView({
  projects,
  onProjectsChanged,
  onOpen,
  onMeetingsChanged,
  toast,
  person,
  all: allNotes,
}: Props) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  /** Le dimensioni scelte nella prima colonna, nell'ordine in cui sono state aggiunte. */
  const [active, setActive] = useState<Dim[]>([person ? "people" : allNotes ? "all" : "projects"]);
  /** Le voci scelte in ogni colonna; una colonna senza voci scelte non filtra. */
  const [sel, setSel] = useState<Partial<Record<FacetDim, string[]>>>(
    person ? { people: [person.toLowerCase()] } : {},
  );
  /** L'ultima voce cliccata o raggiunta con le frecce in ogni colonna: da lì partono Maiusc e le frecce. */
  const [cursor, setCursor] = useState<Partial<Record<FacetDim, string>>>(
    person ? { people: person.toLowerCase() } : {},
  );
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [detail, setDetail] = useState<Meeting | null>(null);
  /** Colonna che riceve le frecce: 0 dimensioni, poi una per dimensione con voci, poi i meeting. */
  const [col, setCol] = useState(person ? 2 : 1);
  /** Si sta usando la tastiera: solo allora si vede la riga dove sono le frecce. Un clic la nasconde. */
  const [usingKeys, setUsingKeys] = useState(false);
  /** Quanti file ci sono (registrazioni comprese), per il numero accanto a File. */
  const [fileCount, setFileCount] = useState<number | null>(null);
  /** Cosa elenca la terza colonna: i meeting, oppure i loro elementi. */
  const [mode, setMode] = useState<"meetings" | "items">("meetings");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [kinds, setKinds] = useState<ReadonlySet<ItemKind>>(new Set(KINDS.map((k) => k.id)));
  const [itemId, setItemId] = useState<number | null>(null);
  /** Meeting scelti insieme (Cmd o Maiusc + clic), per dare loro un tag in un colpo. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [newTag, setNewTag] = useState("");
  /**
   * La finestra del progetto: "new" per crearne uno, `{ under }` per crearne uno dentro un altro,
   * un progetto per modificarlo.
   */
  const [editing, setEditing] = useState<Project | "new" | { under: string } | null>(null);
  /** Il menu delle azioni su un progetto (pulsante ⋯ o clic destro), e dove si apre. */
  const [menu, setMenu] = useState<{ project: Project; at: { x: number; y: number } } | null>(null);
  /** I rami aperti negli alberi dei progetti e dei tag (`projects:<id>`, `tags:progetto`). */
  const [open, setOpen] = useState<ReadonlySet<string>>(readOpen);
  const root = useRef<HTMLDivElement>(null);

  const reload = useCallback(
    () =>
      api
        .listMeetings()
        .then(setMeetings)
        .catch((e) => toast(errorText(e))),
    [toast],
  );
  useEffect(() => void reload(), [reload]);

  useEffect(() => {
    if (mode !== "items") return;
    api
      .listItems()
      .then(setItems)
      .catch((e) => toast(errorText(e)));
  }, [mode, toast]);

  useEffect(() => {
    Promise.all([api.listRecordings(), api.listFiles()])
      .then(([recordings, files]) => setFileCount(recordings.length + files.length))
      .catch(() => setFileCount(null));
  }, []);

  const filesView = active[0] === "files";
  const pinnedOn = active.includes("pinned");
  /** Le colonne di voci, una per dimensione scelta, nell'ordine in cui sono state aggiunte. */
  const facets = useMemo(
    () => active.filter((d): d is FacetDim => d !== "all" && d !== "pinned" && d !== "files"),
    [active],
  );
  const meetingsCol = facets.length + 1;
  const at = Math.min(col, meetingsCol);

  /** Le voci di ogni dimensione su tutti i meeting: il loro nome e quali meeting ne fanno parte. */
  const known = useMemo(() => {
    const out = {} as Record<FacetDim, Map<string, { label: string; ids: Set<string> }>>;
    for (const d of FACETS) {
      out[d] = new Map(
        groupsOf(d, meetings, projects).map((g) => [
          g.key,
          { label: g.label, ids: new Set(g.meetings.map((m) => m.id)) },
        ]),
      );
    }
    return out;
  }, [meetings, projects]);

  /** Le voci scelte in una colonna che esistono ancora. */
  const chosen = useCallback((d: FacetDim) => (sel[d] ?? []).filter((k) => known[d].has(k)), [sel, known]);

  /** I meeting che passano i filtri di tutte le colonne scelte, tranne `skip`. */
  const passing = useCallback(
    (skip?: FacetDim) =>
      meetings.filter(
        (m) =>
          (!pinnedOn || m.pinnedAt !== null) &&
          facets.every((d) => {
            const keys = chosen(d);
            if (d === skip || keys.length === 0) return true;
            const has = (k: string) => known[d].get(k)!.ids.has(m.id);
            return ALL_OF.has(d) ? keys.every(has) : keys.some(has);
          }),
      ),
    [meetings, pinnedOn, facets, chosen, known],
  );

  /**
   * Le voci di ogni dimensione, contate sui meeting che passano i filtri delle altre colonne: dopo
   * due persone, la colonna dei tag mostra solo i tag dei loro meeting.
   */
  const columns = useMemo(() => {
    const out = {} as Record<
      FacetDim,
      {
        /** Le voci da mostrare: quelle dentro un ramo chiuso no. */
        groups: Group[];
        /** Quante voci ha la colonna, anche dentro i rami chiusi. */
        total: number;
        /** Le voci che ne contengono altre. */
        parents: Set<string>;
        narrowed: boolean;
        archived: number;
      }
    >;
    for (const d of FACETS) {
      const keys = chosen(d);
      const narrowed = pinnedOn || facets.some((o) => o !== d && chosen(o).length > 0);
      // filtrando da altre colonne restano le voci con meeting; i progetti archiviati restano
      // nascosti (salvo quelli scelti) finché non si apre «Archiviati»
      const candidates = groupsOf(d, passing(d), projects).filter(
        (g) => keys.includes(g.key) || !narrowed || g.meetings.length > 0,
      );
      const archived = candidates.filter((g) => g.archived && !keys.includes(g.key)).length;
      const all = candidates.filter((g) => keys.includes(g.key) || showArchived || !g.archived);
      // una voce scelta resta in colonna anche quando gli altri filtri le tolgono tutti i meeting
      for (const k of keys) {
        if (!all.some((g) => g.key === k)) all.push({ key: k, label: known[d].get(k)!.label, meetings: [] });
      }
      // in un albero si vedono le voci i cui rami sopra sono tutti aperti
      const byKey = new Map(all.map((g) => [g.key, g]));
      const parents = new Set(all.flatMap((g) => (g.parent && byKey.has(g.parent) ? [g.parent] : [])));
      const shown = (g: Group): boolean => {
        const up = g.parent ? byKey.get(g.parent) : undefined;
        return !up || (open.has(`${d}:${up.key}`) && shown(up));
      };
      out[d] = { groups: all.filter(shown), total: all.length, parents, narrowed, archived };
    }
    return out;
  }, [chosen, pinnedOn, facets, passing, projects, showArchived, known, open]);

  /** Apre o chiude il ramo di una voce. */
  const toggleOpen = (d: FacetDim, key: string, to?: boolean) =>
    setOpen((now) => {
      const id = `${d}:${key}`;
      if (to === now.has(id)) return now;
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveOpen(next);
      return next;
    });

  const filtered = useMemo(() => passing(), [passing]);

  /** Il numero accanto a ogni dimensione: quante voci ha la sua colonna, o quanti meeting. */
  const dimCount = (d: Dim): number | null =>
    d === "files"
      ? fileCount
      : d === "all"
        ? meetings.length
        : d === "pinned"
          ? filtered.filter((m) => m.pinnedAt !== null).length
          : columns[d].total;

  /** Le voci scelte, con il loro nome, per il segnaposto del filtro e i messaggi. */
  const chosenLabels = facets.flatMap((d) => chosen(d).map((k) => hash(d) + known[d].get(k)!.label));
  /** L'unica voce scelta, quando ce n'è una sola in una sola colonna: i messaggi dicono cosa fare. */
  const only =
    facets.length === 1 && !pinnedOn && chosen(facets[0]).length === 1
      ? { dim: facets[0], label: known[facets[0]].get(chosen(facets[0])[0])!.label }
      : null;

  /**
   * Le colonne dei filtri (le dimensioni e al più due di voci: l'ultima dimensione aggiunta a destra,
   * le altre una sopra l'altra a sinistra) sono larghe uguali, poi i meeting e l'anteprima. In una
   * finestra stretta la Libreria scorre in orizzontale, come il Finder.
   */
  const filterCol = "minmax(170px, 220px)";
  const template = filesView
    ? `${filterCol} 1fr`
    : facets.length > 1
      ? `${filterCol} ${filterCol} ${filterCol} minmax(190px, 1fr) minmax(210px, 1.1fr)`
      : facets.length === 1
        ? `${filterCol} ${filterCol} minmax(220px, 1fr) minmax(240px, 1.1fr)`
        : `${filterCol} minmax(220px, 1fr) minmax(240px, 1.1fr)`;

  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // nella vista elementi il testo cercato filtra gli elementi, non i meeting
    const found = (filesView ? [] : filtered).filter(
      (m) =>
        mode === "items" ||
        !q ||
        [m.title, ...m.attendees, ...m.tags].some((s) => s.toLowerCase().includes(q)),
    );
    return found.toSorted((a, b) => (oldestFirst ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [filesView, filtered, filter, oldestFirst, mode]);

  const current = listed.find((m) => m.id === meetingId) ?? listed[0] ?? null;

  /** I meeting scelti insieme che sono ancora in elenco. */
  const selection = useMemo(() => listed.filter((m) => picked.has(m.id)), [listed, picked]);
  const bulk = mode === "meetings" && selection.length > 1;

  /** Gli elementi dei meeting in elenco, nell'ordine dei meeting e poi delle note. */
  const scoped = useMemo<Shown[]>(() => {
    if (mode !== "items") return [];
    const order = new Map(listed.map((m, i) => [m.id, i]));
    const byId = new Map(listed.map((m) => [m.id, m]));
    const q = filter.trim().toLowerCase();
    return items
      .map((item, id) => ({ id, item, meeting: byId.get(item.meetingId)! }))
      .filter(
        ({ item, meeting }) =>
          meeting &&
          (!q || [item.text, item.who ?? "", meeting.title].some((s) => s.toLowerCase().includes(q))),
      )
      .toSorted((a, b) => order.get(a.meeting.id)! - order.get(b.meeting.id)! || a.id - b.id);
  }, [mode, items, listed, filter]);
  const shown = useMemo(() => scoped.filter((s) => kinds.has(s.item.kind)), [scoped, kinds]);
  const currentItem = shown.find((s) => s.id === itemId) ?? shown[0] ?? null;

  useEffect(() => {
    setDetail(null);
    if (!current) return;
    let alive = true;
    api
      .getMeeting(current.id)
      .then((d) => {
        if (alive) setDetail(d.meeting);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- conta solo l'id: ricaricare il dettaglio a ogni nuovo oggetto `current` lo azzererebbe
  }, [current?.id]);

  const archiveProject = async (p: Project) => {
    try {
      onProjectsChanged(await api.archiveProject(p.id, !p.archived));
    } catch (e) {
      toast(errorText(e));
    }
  };

  /** Elimina un progetto (il menu ha già chiesto conferma): i meeting restano, senza progetto. */
  const deleteProject = async (p: Project) => {
    try {
      onProjectsChanged(await api.deleteProject(p.id));
      await reload();
      onMeetingsChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const openMenu = (project: Project, where: { x: number; y: number }) => setMenu({ project, at: where });
  // chiuso il menu, le frecce tornano alla Libreria
  const closeMenu = useCallback(() => {
    setMenu(null);
    root.current?.focus();
  }, []);

  /** Mette i meeting selezionati in un progetto, o li toglie dal loro. */
  const moveSelection = async (projectId: string | null) => {
    try {
      await api.setMeetingsProject(
        selection.map((m) => m.id),
        projectId,
      );
      await reload();
      onMeetingsChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  /** Fissa i meeting nella barra laterale, o li toglie dai fissati. */
  const pinMeetings = async (ids: string[], pinned: boolean) => {
    try {
      await api.setMeetingsPinned(ids, pinned);
      await reload();
      onMeetingsChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  /**
   * Clic su un meeting: da solo lo sceglie, con Cmd lo aggiunge o lo toglie, con Maiusc aggiunge
   * tutti quelli fino a lì, o li toglie se il meeting cliccato era già selezionato.
   */
  const pick = (m: MeetingSummary, e: Mods) => {
    setCol(meetingsCol);
    setMeetingId(m.id);
    if (e.shiftKey && current) {
      const [from, to] = [listed.indexOf(current), listed.indexOf(m)].toSorted((a, b) => a - b);
      const range = listed.slice(from, to + 1).map((x) => x.id);
      setPicked(new Set(shiftRange(picked.size ? [...picked] : [current.id], range, picked.has(m.id))));
    } else if (e.metaKey || e.ctrlKey) {
      // il meeting già in anteprima fa parte della selezione che comincia
      const next = new Set(picked.size || !current ? picked : [current.id]);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      setPicked(next);
    } else setPicked(new Set());
  };

  /** Mette `next` al posto delle dimensioni scelte: le colonne tolte smettono di filtrare. */
  const showDims = (next: Dim[]) => {
    setActive(next);
    setSel((s) => Object.fromEntries(Object.entries(s).filter(([d]) => next.includes(d as Dim))));
  };

  /**
   * Clic su una dimensione, come nel Finder: da solo la sceglie al posto delle altre, con Cmd la
   * aggiunge (o la toglie) e la sua colonna si affianca alle altre, con Maiusc aggiunge tutte quelle
   * fino a lì, o le toglie se la dimensione cliccata era già scelta (ne resta sempre almeno una).
   * I file non filtrano i meeting e Tutte le note non filtra niente: stanno sempre da soli.
   */
  const pickDim = (d: Dim, e: Mods) => {
    setCol(0);
    const groupable = d !== "files" && d !== "all" && !filesView;
    // aggiungendo un filtro a Tutte le note, resta solo il filtro
    const filters = active.filter((x) => x !== "all");
    if (groupable && (e.metaKey || e.ctrlKey)) {
      if (!filters.includes(d)) showDims([...filters, d]);
      else if (filters.length > 1) showDims(filters.filter((x) => x !== d));
    } else if (groupable && e.shiftKey) {
      const ids = DIMS.map((x) => x.id);
      const [from, to] = [ids.indexOf(active.at(-1)!), ids.indexOf(d)].toSorted((a, b) => a - b);
      const range = ids.slice(from, to + 1).filter((x) => x !== "files" && x !== "all");
      const next = shiftRange(filters, range, filters.includes(d));
      if (next.length) showDims(next);
    } else showDims([d]);
  };

  /**
   * Clic su una voce di una colonna: da sola la sceglie, con Cmd la aggiunge o la toglie, con Maiusc
   * aggiunge tutte quelle fino a lì, o le toglie se la voce cliccata era già scelta.
   */
  const pickValue = (d: FacetDim, key: string, e: Mods) => {
    setCol(facets.indexOf(d) + 1);
    const now = chosen(d);
    const keys = columns[d].groups.map((g) => g.key);
    let next = [key];
    if (e.shiftKey && cursor[d] && keys.includes(cursor[d])) {
      const [from, to] = [keys.indexOf(cursor[d]), keys.indexOf(key)].toSorted((a, b) => a - b);
      next = shiftRange(now, keys.slice(from, to + 1), now.includes(key));
    } else if (e.metaKey || e.ctrlKey) {
      next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
    }
    setSel({ ...sel, [d]: next });
    setCursor({ ...cursor, [d]: key });
  };

  /** Aggiunge o toglie tag a tutti i meeting selezionati. */
  const tagSelection = async (add: string[], remove: string[]) => {
    try {
      await api.tagMeetings(
        selection.map((m) => m.id),
        add,
        remove,
      );
      setNewTag("");
      await reload();
      onMeetingsChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

  // frecce: su e giù nella colonna, destra e sinistra tra le colonne, Invio apre il meeting
  const onKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "SELECT") return;
    if (tag === "INPUT" && e.key !== "ArrowDown" && e.key !== "Escape") return;
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (step || e.key === "ArrowLeft" || e.key === "ArrowRight") setUsingKeys(true);
    const move = <T,>(rows: T[], index: number): T | undefined =>
      rows[Math.min(rows.length - 1, Math.max(0, index + step))];
    const facet = at > 0 && at < meetingsCol ? facets[at - 1] : null;
    // ⌘ + freccia sposta solo il cursore, senza cambiare cosa è scelto: poi Spazio sceglie o toglie
    const onlyMove = e.metaKey || e.ctrlKey;
    if (e.key === " " && tag !== "INPUT") {
      e.preventDefault();
      setUsingKeys(true);
      if (facet && cursor[facet]) {
        const now = chosen(facet);
        const key = cursor[facet];
        setSel({ ...sel, [facet]: now.includes(key) ? now.filter((k) => k !== key) : [...now, key] });
      } else if (at === meetingsCol && mode === "meetings" && current) {
        const next = new Set(picked);
        if (!next.delete(current.id)) next.add(current.id);
        setPicked(next);
      }
      return;
    }
    if (step) {
      e.preventDefault();
      if (tag === "INPUT") {
        setCol(meetingsCol);
        root.current?.focus();
        return;
      }
      if (at === 0) {
        // Maiusc + freccia aggiunge la dimensione accanto, la freccia da sola passa all'altra
        const next = move(
          DIMS,
          DIMS.findIndex((d) => d.id === active.at(-1)),
        );
        if (next) pickDim(next.id, { metaKey: false, ctrlKey: false, shiftKey: e.shiftKey });
      } else if (facet) {
        const rows = columns[facet].groups;
        const next = move(
          rows,
          rows.findIndex((g) => g.key === cursor[facet]),
        );
        // Maiusc + freccia allarga la scelta, ⌘ + freccia sposta solo il cursore, la freccia da sola
        // sceglie solo la voce raggiunta
        if (next && onlyMove) setCursor({ ...cursor, [facet]: next.key });
        else if (next && e.shiftKey) {
          setSel({ ...sel, [facet]: [...new Set([...chosen(facet), next.key])] });
          setCursor({ ...cursor, [facet]: next.key });
        } else if (next) pickValue(facet, next.key, { metaKey: false, ctrlKey: false, shiftKey: false });
      } else if (mode === "items") {
        setItemId(move(shown, currentItem ? shown.indexOf(currentItem) : -1)?.id ?? null);
      } else {
        const next = move(listed, current ? listed.indexOf(current) : -1);
        setMeetingId(next?.id ?? null);
        // Maiusc + freccia allarga la selezione, ⌘ + freccia la lascia com'è, la freccia da sola
        // la scioglie
        if (e.shiftKey && current && next) setPicked(new Set([...picked, current.id, next.id]));
        else if (!onlyMove) setPicked(new Set());
      }
    } else if (e.key === "a" && (e.metaKey || e.ctrlKey) && facet) {
      // Cmd A in una colonna di voci le sceglie tutte
      e.preventDefault();
      setSel({ ...sel, [facet]: columns[facet].groups.map((g) => g.key) });
    } else if (e.key === "a" && (e.metaKey || e.ctrlKey) && at === meetingsCol && mode === "meetings") {
      e.preventDefault();
      setPicked(new Set(listed.map((m) => m.id)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      // su una voce con un ramo chiuso, la freccia lo apre; altrimenti passa alla colonna dopo
      const key = facet ? cursor[facet] : undefined;
      if (facet && key && columns[facet].parents.has(key) && !open.has(`${facet}:${key}`))
        toggleOpen(facet, key, true);
      else setCol(Math.min(meetingsCol, at + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      // su un ramo aperto lo chiude, su una voce dentro un altro risale a quella, poi la colonna prima
      const row = facet ? columns[facet].groups.find((g) => g.key === cursor[facet]) : undefined;
      if (facet && row && columns[facet].parents.has(row.key) && open.has(`${facet}:${row.key}`))
        toggleOpen(facet, row.key, false);
      else if (facet && row?.parent && columns[facet].groups.some((g) => g.key === row.parent))
        pickValue(facet, row.parent, { metaKey: false, ctrlKey: false, shiftKey: false });
      else setCol(Math.max(0, at - 1));
    } else if (e.key === "Enter" && mode === "items") {
      if (!currentItem) return;
      e.preventDefault();
      onOpen(currentItem.meeting.id);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      onOpen(current.id);
    } else if (e.key === "Escape") {
      // Esc scioglie la selezione dei meeting; in una colonna di voci toglie le voci scelte
      if (facet && !picked.size) setSel({ ...sel, [facet]: [] });
      setPicked(new Set());
      root.current?.focus();
    }
  };

  // la riga raggiunta resta in vista mentre si scorre con le frecce
  useEffect(() => {
    root.current
      ?.querySelectorAll(".lib-row.cur, .lib-meeting.on, .lib-item.on")
      .forEach((el) => el.scrollIntoView({ block: "nearest" }));
  }, [active, cursor, current?.id, currentItem?.id]);

  useEffect(() => root.current?.focus(), []);

  // con molte colonne affiancate la Libreria scorre di lato: la colonna attiva resta in vista, e
  // scegliendo un meeting si vede anche l'anteprima, come nel Finder
  const cols = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = cols.current;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    if (at === meetingsCol) box.scrollTo({ left: box.scrollWidth, behavior: "smooth" });
    else box.querySelector(".lib-col.focus")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [at, meetingsCol]);

  /** I tag dei meeting selezionati, con quanti di loro li hanno. */
  const selectionTags = useMemo(() => groupBy(selection, (m) => m.tags), [selection]);
  const knownTags = useMemo(() => groupBy(meetings, (m) => m.tags).map((g) => g.key), [meetings]);
  const cleanTag = newTag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s,]+/g, "-");

  const projectOf = (m: MeetingSummary) => projects.find((p) => p.id === m.projectId);
  /** Il progetto comune a tutti i meeting selezionati, se è lo stesso per tutti. */
  const selectionProject = selection.every((m) => m.projectId === selection[0]?.projectId)
    ? (selection[0]?.projectId ?? "")
    : "mixed";
  const info = detail && current && detail.id === current.id ? digest(detail) : null;
  const facts = info
    ? [
        info.openTasks
          ? info.openTasks === 1
            ? t("1 azione aperta")
            : t("{n} azioni aperte", { n: info.openTasks })
          : null,
        info.quotes ? (info.quotes === 1 ? t("1 citazione") : t("{n} citazioni", { n: info.quotes })) : null,
        info.moments
          ? info.moments === 1
            ? t("1 momento segnato")
            : t("{n} momenti segnati", { n: info.moments })
          : null,
      ].filter((f): f is string => !!f)
    : [];

  /** Una colonna di voci: `i` è la sua posizione tra le dimensioni scelte, per le frecce. */
  const facetCol = (d: FacetDim, i: number) => {
    const { groups, narrowed, parents } = columns[d];
    const keys = chosen(d);
    const tree = groups.some((g) => (g.depth ?? 0) > 0) || parents.size > 0;
    return (
      <div
        key={d}
        className={"lib-col" + (at === i + 1 ? " focus" : "")}
        role="listbox"
        aria-multiselectable="true"
        aria-label={DIMS.find((x) => x.id === d)!.label()}
      >
        {facets.length > 1 && (
          <div className="lib-facet-head" aria-hidden="true">
            {DIMS.find((x) => x.id === d)!.label()}
          </div>
        )}
        {d === "projects" && !narrowed && (
          <button className="lib-new" onClick={() => setEditing("new")}>
            {t("+ Nuovo progetto")}
          </button>
        )}
        {groups.map((g) => (
          <div
            key={g.key}
            className={
              "lib-row" +
              (keys.includes(g.key) ? " on" : "") +
              (g.key === cursor[d] ? " cur" : "") +
              (g.archived ? " archived" : "") +
              (tree ? " tree" : "")
            }
            style={tree ? ({ "--depth": g.depth ?? 0 } as React.CSSProperties) : undefined}
            // clic destro su un progetto: lo stesso menu del pulsante ⋯, come nel Finder
            onContextMenu={
              g.project
                ? (e) => {
                    e.preventDefault();
                    openMenu(g.project!, { x: e.clientX, y: e.clientY });
                  }
                : undefined
            }
          >
            {tree &&
              (parents.has(g.key) ? (
                <button
                  className="lib-twisty"
                  aria-expanded={open.has(`${d}:${g.key}`)}
                  aria-label={
                    open.has(`${d}:${g.key}`)
                      ? t("Chiudi {name}", { name: g.short ?? g.label })
                      : t("Apri {name}", { name: g.short ?? g.label })
                  }
                  onClick={() => toggleOpen(d, g.key)}
                >
                  <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                    <path
                      d="M3.5 2 L7 5 L3.5 8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : (
                <span className="lib-twisty" aria-hidden="true" />
              ))}
            <button
              role="option"
              aria-selected={keys.includes(g.key)}
              className="lib-row-main"
              title={g.project?.description || (g.short ? hash(d) + g.label : undefined)}
              onClick={(e) => pickValue(d, g.key, e)}
            >
              {g.project && <ProjectDot project={g.project} />}
              <span className="lib-label">
                {hash(d)}
                {g.short ?? g.label}
              </span>
              <span className="lib-count">{g.meetings.length}</span>
            </button>
            {g.project && (
              <button
                className={"lib-act lib-menu-btn" + (menu?.project.id === g.key ? " open" : "")}
                aria-haspopup="menu"
                aria-expanded={menu?.project.id === g.key}
                aria-label={t("Azioni sul progetto {name}", { name: g.project.name })}
                title={t("Azioni sul progetto")}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu(g.project!, { x: r.right, y: r.bottom + 4 });
                }}
              >
                ⋯
              </button>
            )}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="muted small lib-empty">
            {narrowed
              ? t("Nessuna voce nelle note scelte dalle altre colonne.")
              : d === "projects"
                ? t("Nessun progetto: creane uno con + Nuovo progetto.")
                : d === "tags"
                  ? t("Nessun tag: aggiungine uno a una nota, sotto il titolo.")
                  : d === "people"
                    ? t("Nessun partecipante nelle note.")
                    : t("Ancora nessuna nota")}
          </p>
        )}
        {d === "projects" && columns.projects.archived > 0 && (
          <button className="lib-more" onClick={() => setShowArchived((v) => !v)}>
            {showArchived
              ? t("Nascondi archiviati")
              : t("Archiviati ({n})", { n: columns.projects.archived })}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={"library" + (usingKeys ? " keys" : "")}
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={() => setUsingKeys(false)}
    >
      <header className="lib-top">
        <h1 className="lib-title">{t("Libreria")}</h1>
        <input
          className="search lib-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t("Filtra le note elencate")}
          placeholder={
            chosenLabels.length > 0 && chosenLabels.length <= 2
              ? t("Filtra in {name}", { name: chosenLabels.join(" + ") })
              : t("Filtra le note elencate")
          }
        />
        <button
          className="btn small ghost"
          onClick={() => setOldestFirst((v) => !v)}
          title={t("Cambia l'ordine delle note")}
        >
          {oldestFirst ? t("↑ Più vecchi") : t("↓ Più recenti")}
        </button>
        {!filesView && (
          <div className="seg lib-mode" role="group" aria-label={t("Cosa elencare")}>
            <button
              className={mode === "meetings" ? "on" : ""}
              aria-pressed={mode === "meetings"}
              onClick={() => setMode("meetings")}
            >
              {t("Note")}
            </button>
            <button
              className={mode === "items" ? "on" : ""}
              aria-pressed={mode === "items"}
              title={t("Decisioni, azioni e citazioni scritte in queste note")}
              onClick={() => setMode("items")}
            >
              {t("Elementi")}
            </button>
          </div>
        )}
      </header>

      <div className="lib-cols" ref={cols} style={{ gridTemplateColumns: template }}>
        <div
          className={"lib-col" + (at === 0 ? " focus" : "")}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t("Raggruppa per")}
          title={t("⌘ clic su un'altra dimensione: la sua colonna si affianca e filtra insieme alle altre")}
        >
          {DIMS.map((d) => (
            <button
              key={d.id}
              role="option"
              aria-selected={active.includes(d.id)}
              className={
                "lib-row" + (active.includes(d.id) ? " on" : "") + (d.id === active.at(-1) ? " cur" : "")
              }
              onClick={(e) => pickDim(d.id, e)}
            >
              <span className="lib-icon" aria-hidden="true">
                {d.icon}
              </span>
              <span className="lib-label">{d.label()}</span>
              <span className="lib-count">{dimCount(d.id)}</span>
            </button>
          ))}
          <ul className="lib-keys" aria-label={t("Come scegliere")}>
            <li>
              <kbd>{t("Clic")}</kbd> {t("sceglie solo questa")}
            </li>
            <li>
              <kbd>⌘ {t("clic")}</kbd> {t("aggiunge o toglie questa")}
            </li>
            <li>
              <kbd>⇧ {t("clic")}</kbd> {t("aggiunge o toglie tutte fino a qui")}
            </li>
            <li>
              <kbd>⌘ ↑↓</kbd> {t("sposta senza scegliere")}, <kbd>{t("Spazio")}</kbd> {t("aggiunge o toglie")}
            </li>
          </ul>
        </div>

        {filesView && (
          <div className="lib-col lib-recordings">
            <Files onOpen={onOpen} toast={toast} onCount={setFileCount} />
          </div>
        )}

        {facets.length === 1 && <div className="lib-facets">{facetCol(facets[0], 0)}</div>}
        {facets.length > 1 && (
          // l'ultima dimensione aggiunta ha la seconda colonna; le altre si dividono la prima in altezza
          <div className="lib-facets">
            <div className="lib-stack">{facets.slice(0, -1).map((d, i) => facetCol(d, i))}</div>
            {facetCol(facets.at(-1)!, facets.length - 1)}
          </div>
        )}

        {mode === "items" && !filesView && (
          <div className={"lib-col lib-items" + (at === meetingsCol ? " focus" : "")}>
            <div className="lib-kinds" role="group" aria-label={t("Tipi di elemento")}>
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  className={"chip lib-kind" + (kinds.has(k.id) ? " on" : "")}
                  aria-pressed={kinds.has(k.id)}
                  onClick={() => {
                    const next = new Set(kinds);
                    if (next.has(k.id)) next.delete(k.id);
                    else next.add(k.id);
                    setKinds(next);
                  }}
                >
                  {k.icon} {k.label()}
                  <span className="lib-count">{scoped.filter((s) => s.item.kind === k.id).length}</span>
                </button>
              ))}
            </div>
            <div role="listbox" aria-label={t("Elementi")} className="lib-item-list">
              {shown.map((s) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={s.id === currentItem?.id}
                  className={
                    `lib-item ${s.item.kind}` +
                    (s.id === currentItem?.id ? " on" : "") +
                    (s.item.done ? " done" : "")
                  }
                  title={t("Doppio clic o Invio: apre la nota")}
                  onClick={() => {
                    setItemId(s.id);
                    setCol(meetingsCol);
                  }}
                  onDoubleClick={() => onOpen(s.meeting.id)}
                >
                  <span className="lib-item-icon" aria-hidden="true">
                    {s.item.kind === "action"
                      ? s.item.done
                        ? "☑"
                        : "☐"
                      : KINDS.find((k) => k.id === s.item.kind)!.icon}
                  </span>
                  <span className="lib-item-body">
                    <span className="lib-item-text">{plain(s.item.text)}</span>
                    <span className="lib-meeting-meta">
                      {s.item.kind === "action" && (s.item.done ? `${t("Fatta")} · ` : "")}
                      {s.item.who ? `${s.item.who} · ` : ""}
                      {s.item.ms !== null ? `${mmss(s.item.ms)} · ` : ""}
                      {s.meeting.title || t("Senza titolo")} · {dayLabel(s.meeting.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {shown.length === 0 && (
              <p className="muted small lib-empty">
                {scoped.length > 0
                  ? t("Nessun elemento dei tipi scelti: riattiva un tipo qui sopra.")
                  : filter
                    ? t("Nessun risultato")
                    : t(
                        "Nessun elemento qui. Nelle note, un riquadro decisione, una checklist o una citazione dalla trascrizione compaiono in questo elenco.",
                      )}
              </p>
            )}
          </div>
        )}

        <div
          hidden={filesView || mode === "items"}
          className={"lib-col lib-meetings" + (at === meetingsCol ? " focus" : "")}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t("Note")}
        >
          {listed.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={bulk ? picked.has(m.id) : m.id === current?.id}
              className={
                "lib-meeting" +
                (m.id === current?.id ? " on" : "") +
                (bulk && picked.has(m.id) ? " picked" : "")
              }
              onClick={(e) => pick(m, e)}
              onDoubleClick={() => onOpen(m.id)}
            >
              <span className="lib-meeting-title">
                {m.pinnedAt !== null && !pinnedOn && (
                  <span className="lib-pinned" title={t("Fissato nella barra laterale")}>
                    <PinIcon filled />
                  </span>
                )}
                {m.title || t("Senza titolo")}
              </span>
              <span className="lib-meeting-meta">
                {dayLabel(m.createdAt)}
                {m.attendees.length
                  ? ` · ${m.attendees.slice(0, 3).join(", ")}${m.attendees.length > 3 ? "…" : ""}`
                  : ""}
                {m.hasEnhanced && sparkle(" · ✦")}
              </span>
            </button>
          ))}
          {!filesView && listed.length === 0 && (
            <p className="muted small lib-empty">
              {filter
                ? t("Nessun risultato")
                : meetings.length === 0
                  ? t("Ancora nessuna nota")
                  : pinnedOn && chosenLabels.length === 0
                    ? t(
                        "Nessuna nota fissata: aprine una e premi la puntina accanto a copia, stampa ed elimina.",
                      )
                    : only?.dim === "projects"
                      ? t("Nessuna nota qui: apri una nota e scegli questo progetto, in alto a destra.")
                      : only?.dim === "tags"
                        ? t("Nessuna nota qui: aggiungi il tag #{tag} a una nota.", { tag: only.label })
                        : t("Nessuna nota qui.")}
            </p>
          )}
        </div>

        <div hidden={filesView || mode === "items"} className="lib-col lib-preview">
          {bulk ? (
            <>
              <h2>{t("{n} note selezionate", { n: selection.length })}</h2>
              <p className="muted small">
                {t("Il progetto e i tag scelti qui valgono per tutte le note selezionate.")}
              </p>
              <select
                className="chip select lib-bulk-project"
                value={selectionProject}
                aria-label={t("Progetto delle note selezionate")}
                onChange={(e) => moveSelection(e.target.value || null)}
              >
                {selectionProject === "mixed" && <option value="mixed">{t("Progetti diversi")}</option>}
                <option value="">{t("Nessun progetto")}</option>
                {projectOptions(projects, selectionProject).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <form
                className="lib-bulk-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (cleanTag) tagSelection([cleanTag], []);
                }}
              >
                <input
                  className="search"
                  list="lib-known-tags"
                  value={newTag}
                  spellCheck={false}
                  onChange={(e) => setNewTag(e.target.value)}
                  // le frecce qui scorrono i tag proposti, non le colonne
                  onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()}
                  aria-label={t("Tag da aggiungere alle note selezionate")}
                  placeholder={t("Nome del tag")}
                />
                <datalist id="lib-known-tags">
                  {knownTags.map((tag) => (
                    <option key={tag} value={tag} aria-label={tag} />
                  ))}
                </datalist>
                <button className="btn small" disabled={!cleanTag}>
                  {t("Aggiungi a tutti")}
                </button>
              </form>
              {selectionTags.length > 0 && (
                <p className="lib-tags">
                  {selectionTags.map((g) => (
                    <span key={g.key} className="chip tag">
                      #{g.label}
                      {g.meetings.length < selection.length && (
                        <button
                          type="button"
                          className="lib-partial"
                          title={t("Solo {n} su {total} lo hanno: aggiungilo agli altri", {
                            n: g.meetings.length,
                            total: selection.length,
                          })}
                          onClick={() => tagSelection([g.key], [])}
                        >
                          {g.meetings.length}/{selection.length} +
                        </button>
                      )}
                      <button
                        type="button"
                        className="chip-x"
                        aria-label={t("Togli #{tag} dalle note selezionate", { tag: g.label })}
                        title={t("Togli #{tag} dalle note selezionate", { tag: g.label })}
                        onClick={() => tagSelection([], [g.key])}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </p>
              )}
              {selection.every((m) => m.pinnedAt !== null) ? (
                <button
                  className="btn small"
                  onClick={() =>
                    pinMeetings(
                      selection.map((m) => m.id),
                      false,
                    )
                  }
                >
                  {t("Togli tutti dai fissati")}
                </button>
              ) : (
                <button
                  className="btn small"
                  onClick={() =>
                    pinMeetings(
                      selection.map((m) => m.id),
                      true,
                    )
                  }
                >
                  {t("Fissa tutti nella barra laterale")}
                </button>
              )}
              <button className="btn small ghost" onClick={() => setPicked(new Set())}>
                {t("Annulla la selezione")}
              </button>
            </>
          ) : current ? (
            <>
              <h2>{current.title || t("Senza titolo")}</h2>
              <p className="muted small">
                {dayLabel(current.createdAt)} · {time(current.createdAt)}
              </p>
              {projectOf(current) && (
                <p className="small lib-project">
                  <ProjectDot project={projectOf(current)!} />
                  {projectTitle(current.projectId, projects)}
                </p>
              )}
              {current.attendees.length > 0 && <p className="small">{current.attendees.join(", ")}</p>}
              {current.tags.length > 0 && (
                <p className="lib-tags">
                  {current.tags.map((tag) => (
                    <span key={tag} className="side-tag">
                      #{tag}
                    </span>
                  ))}
                </p>
              )}
              {info?.text && <p className="lib-text">{info.text}</p>}
              {facts.length > 0 && (
                <ul className="lib-facts">
                  {facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              <div className="lib-actions">
                <button className="btn small" onClick={() => onOpen(current.id)}>
                  {t("Apri la nota")}
                </button>
                <button
                  className={"btn small ghost" + (current.pinnedAt !== null ? " on" : "")}
                  aria-pressed={current.pinnedAt !== null}
                  onClick={() => pinMeetings([current.id], current.pinnedAt === null)}
                  title={
                    current.pinnedAt !== null
                      ? t("Togli dai fissati")
                      : t("Fissa nella barra laterale: resta sotto la Libreria")
                  }
                >
                  <PinIcon filled={current.pinnedAt !== null} />{" "}
                  {current.pinnedAt !== null ? t("Fissato") : t("Fissa")}
                </button>
              </div>
              <p className="muted small lib-hint">
                {t(
                  "⌘ clic o Maiusc clic su altre note: le selezioni insieme per dare loro un progetto o un tag.",
                )}
              </p>
            </>
          ) : (
            <p className="muted small">{t("Scegli una nota per vederne l'anteprima.")}</p>
          )}
        </div>
      </div>
      {menu && (
        <Menu
          at={menu.at}
          label={t("Azioni sul progetto {name}", { name: menu.project.name })}
          onClose={closeMenu}
          items={[
            {
              label: t("Nuovo progetto dentro…"),
              onSelect: () => setEditing({ under: menu.project.id }),
            },
            { label: t("Modifica…"), onSelect: () => setEditing(menu.project) },
            {
              label: menu.project.archived ? t("Riattiva") : t("Archivia"),
              onSelect: () => void archiveProject(menu.project),
            },
            {
              label: t("Elimina…"),
              confirm: t("Elimina: le note restano"),
              danger: true,
              onSelect: () => void deleteProject(menu.project),
            },
          ]}
        />
      )}
      {editing && (
        <ProjectDialog
          project={editing === "new" || "under" in editing ? undefined : editing}
          onClose={() => setEditing(null)}
          projects={projects}
          parentId={typeof editing === "object" && "under" in editing ? editing.under : undefined}
          onSaved={(saved, all) => {
            setEditing(null);
            onProjectsChanged(all);
            // il nuovo progetto si vede anche dentro un ramo che era chiuso
            for (const up of projectPath(saved.id, all).slice(0, -1)) toggleOpen("projects", up.id, true);
            showDims(["projects"]);
            setSel({ projects: [saved.id] });
            setCursor({ projects: saved.id });
          }}
        />
      )}
    </div>
  );
}
