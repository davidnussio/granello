import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { ItemKind, LibraryItem, Meeting, MeetingSummary, Project } from "../types";
import { dayLabel, mmss, time } from "../format";
import { locale, t } from "../i18n";
import { sparkle } from "../sparkles";
import Recordings from "./Recordings";
import ProjectDialog, { ProjectDot } from "./ProjectDialog";

interface Props {
  projects: Project[];
  onProjectsChanged: (projects: Project[]) => void;
  onOpen: (meetingId: string) => void;
  /** Tag o progetto di qualche meeting sono cambiati: chi tiene un elenco di meeting lo ricarica. */
  onMeetingsChanged: () => void;
  toast: (text: string) => void;
}

type Dim = "projects" | "people" | "tags" | "period" | "recordings";
/** Le dimensioni che raggruppano i meeting (le registrazioni no). */
type GroupDim = Exclude<Dim, "recordings">;

/** Il filtro in cima: un valore di una dimensione che restringe tutto il resto. */
interface Cross {
  dim: GroupDim;
  key: string;
  label: string;
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
  label: string;
  meetings: MeetingSummary[];
  archived?: boolean;
  /** Solo nella dimensione dei progetti: il progetto di questa voce. */
  project?: Project;
}

const DIMS: { id: Dim; icon: string; label: () => string }[] = [
  { id: "projects", icon: "▣", label: () => t("Progetti") },
  { id: "people", icon: "☺", label: () => t("Persone") },
  { id: "tags", icon: "#", label: () => t("Tag") },
  { id: "period", icon: "▦", label: () => t("Periodo") },
  // non raggruppa i meeting: mostra l'audio salvato, con il player e il link al meeting
  { id: "recordings", icon: "◉", label: () => t("Registrazioni") },
];

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

/** Le voci di una dimensione, ognuna con i suoi meeting. */
function groupsOf(dim: GroupDim, meetings: MeetingSummary[], projects: Project[]): Group[] {
  if (dim === "people") return groupBy(meetings, (m) => m.attendees);
  if (dim === "period") return byPeriod(meetings);
  if (dim === "tags") return groupBy(meetings, (m) => m.tags);
  // un progetto resta in elenco anche prima di avere meeting
  return projects
    .map((p) => ({
      key: p.id,
      label: p.name,
      meetings: meetings.filter((m) => m.projectId === p.id),
      archived: p.archived,
      project: p,
    }))
    .toSorted(
      (a, b) => Number(a.archived) - Number(b.archived) || a.project.name.localeCompare(b.project.name),
    );
}

const hash = (dim: GroupDim) => (dim === "tags" ? "#" : "");

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
    .filter((l) => l && !/^(:{3,}|```|\||\[\[|!\[)/.test(l))
    .map((l) =>
      l
        .replace(/^(#{1,6}|[-*+]|\d+\.|>)\s+/, "")
        .replace(/^\[[ xX]\]\s+/, "")
        .replace(/[*_`=]{1,2}/g, ""),
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
}: Props) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [dim, setDim] = useState<Dim>("projects");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [detail, setDetail] = useState<Meeting | null>(null);
  /** Colonna che riceve le frecce: 0 dimensione, 1 valori, 2 meeting. */
  const [col, setCol] = useState(1);
  /** Seconda dimensione: restringe le colonne ai meeting che hanno anche questo valore. */
  const [cross, setCross] = useState<Cross | null>(null);
  /** Cosa elenca la terza colonna: i meeting, oppure i loro elementi. */
  const [mode, setMode] = useState<"meetings" | "items">("meetings");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [kinds, setKinds] = useState<ReadonlySet<ItemKind>>(new Set(KINDS.map((k) => k.id)));
  const [itemId, setItemId] = useState<number | null>(null);
  /** Meeting scelti insieme (Cmd o Maiusc + clic), per dare loro un tag in un colpo. */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [newTag, setNewTag] = useState("");
  /** La finestra del progetto: "new" per crearne uno, un progetto per modificarlo. */
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  /** Il progetto di cui si è chiesto di confermare l'eliminazione. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
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

  /** Le voci di ogni dimensione su tutti i meeting: da qui si sceglie il filtro in cima. */
  const crossOptions = useMemo(
    () =>
      DIMS.filter((d): d is (typeof DIMS)[number] & { id: GroupDim } => d.id !== "recordings").map((d) => ({
        ...d,
        groups: groupsOf(d.id, meetings, projects).filter((g) => g.meetings.length > 0),
      })),
    [meetings, projects],
  );

  /** I meeting che passano il filtro in cima. */
  const base = useMemo(() => {
    if (!cross) return meetings;
    const options = crossOptions.find((d) => d.id === cross.dim)?.groups;
    return options?.find((g) => g.key === cross.key)?.meetings ?? [];
  }, [cross, crossOptions, meetings]);

  const groups = useMemo<Group[]>(() => {
    if (dim === "recordings") return [];
    const all = groupsOf(dim, base, projects);
    // con il filtro in cima restano solo le voci che hanno meeting, tolta quella del filtro stesso
    if (cross) return all.filter((g) => g.meetings.length > 0 && !(dim === cross.dim && g.key === cross.key));
    if (dim !== "projects") return all;
    return all.filter((g) => showArchived || !g.archived || g.key === groupKey);
  }, [dim, base, projects, cross, showArchived, groupKey]);

  const group = groups.find((g) => g.key === groupKey) ?? groups[0] ?? null;

  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    // nella vista elementi il testo cercato filtra gli elementi, non i meeting
    const found = (group?.meetings ?? []).filter(
      (m) =>
        mode === "items" ||
        !q ||
        [m.title, ...m.attendees, ...m.tags].some((s) => s.toLowerCase().includes(q)),
    );
    return found.toSorted((a, b) => (oldestFirst ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [group, filter, oldestFirst, mode]);

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

  /** Il primo clic chiede conferma, il secondo elimina: i meeting restano, senza progetto. */
  const deleteProject = async (p: Project) => {
    if (confirmDelete !== p.id) {
      setConfirmDelete(p.id);
      return;
    }
    setConfirmDelete(null);
    try {
      onProjectsChanged(await api.deleteProject(p.id));
      await reload();
      onMeetingsChanged();
    } catch (e) {
      toast(errorText(e));
    }
  };

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

  /** Clic su un meeting: da solo lo sceglie, con Cmd lo aggiunge alla selezione, con Maiusc fino a lì. */
  const pick = (m: MeetingSummary, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    setCol(2);
    setMeetingId(m.id);
    if (e.shiftKey && current) {
      const [from, to] = [listed.indexOf(current), listed.indexOf(m)].toSorted((a, b) => a - b);
      setPicked(new Set([...picked, ...listed.slice(from, to + 1).map((x) => x.id)]));
    } else if (e.metaKey || e.ctrlKey) {
      // il meeting già in anteprima fa parte della selezione che comincia
      const next = new Set(picked.size || !current ? picked : [current.id]);
      if (next.has(m.id)) next.delete(m.id);
      else next.add(m.id);
      setPicked(next);
    } else setPicked(new Set());
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
    const move = <T,>(rows: T[], index: number): T | undefined =>
      rows[Math.min(rows.length - 1, Math.max(0, index + step))];
    if (step) {
      e.preventDefault();
      if (tag === "INPUT") {
        setCol(2);
        root.current?.focus();
        return;
      }
      if (col === 0) {
        const next = move(
          DIMS,
          DIMS.findIndex((d) => d.id === dim),
        );
        if (next) {
          setDim(next.id);
          setGroupKey(null);
        }
      } else if (col === 1) setGroupKey(move(groups, group ? groups.indexOf(group) : -1)?.key ?? null);
      else if (mode === "items") {
        setItemId(move(shown, currentItem ? shown.indexOf(currentItem) : -1)?.id ?? null);
      } else {
        const next = move(listed, current ? listed.indexOf(current) : -1);
        setMeetingId(next?.id ?? null);
        // Maiusc + freccia allarga la selezione, la freccia da sola la scioglie
        if (e.shiftKey && current && next) setPicked(new Set([...picked, current.id, next.id]));
        else setPicked(new Set());
      }
    } else if (e.key === "a" && (e.metaKey || e.ctrlKey) && col === 2 && mode === "meetings") {
      e.preventDefault();
      setPicked(new Set(listed.map((m) => m.id)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setCol((c) => Math.min(2, c + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setCol((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && mode === "items") {
      if (!currentItem) return;
      e.preventDefault();
      onOpen(currentItem.meeting.id);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      onOpen(current.id);
    } else if (e.key === "Escape") {
      setPicked(new Set());
      root.current?.focus();
    }
  };

  // la riga selezionata resta in vista mentre si scorre con le frecce
  useEffect(() => {
    root.current
      ?.querySelectorAll(".lib-row.on, .lib-meeting.on, .lib-item.on")
      .forEach((el) => el.scrollIntoView({ block: "nearest" }));
  }, [dim, group?.key, current?.id, currentItem?.id]);

  useEffect(() => root.current?.focus(), []);

  /** I tag dei meeting selezionati, con quanti di loro li hanno. */
  const selectionTags = useMemo(() => groupBy(selection, (m) => m.tags), [selection]);
  const knownTags = useMemo(() => groupBy(meetings, (m) => m.tags).map((g) => g.key), [meetings]);
  const cleanTag = newTag
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s,]+/g, "-");

  const archivedCount = projects.filter((p) => p.archived).length;
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

  return (
    <div className="library" ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="lib-top">
        <h1 className="lib-title">{t("Libreria")}</h1>
        <input
          className="search lib-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t("Filtra i meeting elencati")}
          placeholder={group ? t("Filtra in {name}", { name: group.label }) : t("Filtra i meeting elencati")}
        />
        {dim === "recordings" ? null : cross ? (
          <span className="chip lib-cross">
            {DIMS.find((d) => d.id === cross.dim)!.icon} {hash(cross.dim)}
            {cross.label}
            <button
              type="button"
              className="chip-x"
              aria-label={t("Togli il filtro {name}", { name: cross.label })}
              title={t("Togli il filtro {name}", { name: cross.label })}
              onClick={() => setCross(null)}
            >
              ×
            </button>
          </span>
        ) : (
          <select
            className="chip select lib-cross"
            value=""
            aria-label={t("Incrocia con un'altra dimensione")}
            title={t(
              "Mostra solo i meeting che hanno anche questo: una persona dentro un progetto, un tag in un mese…",
            )}
            onChange={(e) => {
              const [id, key] = e.target.value.split(/:(.*)/s);
              const found = crossOptions.find((d) => d.id === id)?.groups.find((g) => g.key === key);
              if (found) setCross({ dim: id as GroupDim, key, label: found.label });
            }}
          >
            <option value="">{t("+ Incrocia con…")}</option>
            {crossOptions.map((d) => (
              <optgroup key={d.id} label={d.label()}>
                {d.groups.map((g) => (
                  <option key={g.key} value={`${d.id}:${g.key}`}>
                    {hash(d.id)}
                    {g.label} ({g.meetings.length})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <button
          className="btn small ghost"
          onClick={() => setOldestFirst((v) => !v)}
          title={t("Cambia l'ordine dei meeting")}
        >
          {oldestFirst ? t("↑ Più vecchi") : t("↓ Più recenti")}
        </button>
        {dim !== "recordings" && (
          <div className="seg lib-mode" role="group" aria-label={t("Cosa elencare")}>
            <button
              className={mode === "meetings" ? "on" : ""}
              aria-pressed={mode === "meetings"}
              onClick={() => setMode("meetings")}
            >
              {t("Meeting")}
            </button>
            <button
              className={mode === "items" ? "on" : ""}
              aria-pressed={mode === "items"}
              title={t("Decisioni, azioni e citazioni scritte nelle note di questi meeting")}
              onClick={() => setMode("items")}
            >
              {t("Elementi")}
            </button>
          </div>
        )}
      </header>

      <div className="lib-cols">
        <div
          className={"lib-col" + (col === 0 ? " focus" : "")}
          role="listbox"
          aria-label={t("Raggruppa per")}
        >
          {DIMS.map((d) => (
            <button
              key={d.id}
              role="option"
              aria-selected={d.id === dim}
              className={"lib-row" + (d.id === dim ? " on" : "")}
              onClick={() => {
                setDim(d.id);
                setGroupKey(null);
                setCol(0);
              }}
            >
              <span className="lib-icon" aria-hidden="true">
                {d.icon}
              </span>
              {d.label()}
            </button>
          ))}
        </div>

        {dim === "recordings" && (
          <div className="lib-col lib-recordings">
            <Recordings onOpen={onOpen} toast={toast} />
          </div>
        )}

        <div
          hidden={dim === "recordings"}
          className={"lib-col" + (col === 1 ? " focus" : "")}
          role="listbox"
          aria-label={DIMS.find((d) => d.id === dim)!.label()}
        >
          {dim === "projects" && !cross && (
            <button className="lib-new" onClick={() => setEditing("new")}>
              {t("+ Nuovo progetto")}
            </button>
          )}
          {groups.map((g) => (
            <div
              key={g.key}
              className={"lib-row" + (g.key === group?.key ? " on" : "") + (g.archived ? " archived" : "")}
            >
              <button
                role="option"
                aria-selected={g.key === group?.key}
                className="lib-row-main"
                title={g.project?.description || undefined}
                onClick={() => {
                  setGroupKey(g.key);
                  setCol(1);
                }}
              >
                {g.project && <ProjectDot project={g.project} />}
                <span className="lib-label">
                  {dim !== "recordings" && hash(dim)}
                  {g.label}
                </span>
                <span className="lib-count">{g.meetings.length}</span>
              </button>
              {g.project && !cross && (
                <>
                  <button
                    className="lib-act"
                    onClick={() => setEditing(g.project!)}
                    aria-label={t("Modifica il progetto")}
                    title={t("Cambia nome, colore e descrizione")}
                  >
                    ✎
                  </button>
                  <button
                    className="lib-act"
                    onClick={() => archiveProject(g.project!)}
                    aria-label={g.archived ? t("Riattiva") : t("Archivia")}
                    title={
                      g.archived
                        ? t("Riporta il progetto tra quelli attivi")
                        : t("Archivia: il progetto è chiuso, i meeting restano")
                    }
                  >
                    {g.archived ? "⤒" : "⤓"}
                  </button>
                  <button
                    className={"lib-act" + (confirmDelete === g.key ? " confirm" : "")}
                    onClick={() => deleteProject(g.project!)}
                    onBlur={() => setConfirmDelete(null)}
                    aria-label={t("Elimina il progetto {name}", { name: g.project.name })}
                    title={t("Elimina il progetto: i suoi meeting restano, senza progetto")}
                  >
                    {confirmDelete === g.key ? t("Elimina?") : "×"}
                  </button>
                </>
              )}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="muted small lib-empty">
              {cross
                ? t("Nessun meeting ha anche {name}.", { name: hash(cross.dim) + cross.label })
                : dim === "projects"
                  ? t("Nessun progetto: creane uno con + Nuovo progetto.")
                  : dim === "tags"
                    ? t("Nessun tag: aggiungine uno a un meeting, sotto il titolo.")
                    : dim === "people"
                      ? t("Nessun partecipante nei meeting.")
                      : t("Ancora nessun meeting")}
            </p>
          )}
          {dim === "projects" && !cross && archivedCount > 0 && (
            <button className="lib-more" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? t("Nascondi archiviati") : t("Archiviati ({n})", { n: archivedCount })}
            </button>
          )}
        </div>

        {mode === "items" && dim !== "recordings" && (
          <div className={"lib-col lib-items" + (col === 2 ? " focus" : "")}>
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
                  title={t("Doppio clic o Invio: apre il meeting")}
                  onClick={() => {
                    setItemId(s.id);
                    setCol(2);
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
          hidden={dim === "recordings" || mode === "items"}
          className={"lib-col lib-meetings" + (col === 2 ? " focus" : "")}
          role="listbox"
          aria-multiselectable="true"
          aria-label={t("Meeting")}
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
              <span className="lib-meeting-title">{m.title || t("Senza titolo")}</span>
              <span className="lib-meeting-meta">
                {dayLabel(m.createdAt)}
                {m.attendees.length
                  ? ` · ${m.attendees.slice(0, 3).join(", ")}${m.attendees.length > 3 ? "…" : ""}`
                  : ""}
                {m.hasEnhanced && sparkle(" · ✦")}
              </span>
            </button>
          ))}
          {group && listed.length === 0 && (
            <p className="muted small lib-empty">
              {filter
                ? t("Nessun risultato")
                : cross || (dim !== "tags" && dim !== "projects")
                  ? t("Nessun meeting qui.")
                  : dim === "projects"
                    ? t("Nessun meeting qui: apri un meeting e scegli questo progetto, in alto a destra.")
                    : t("Nessun meeting qui: aggiungi il tag #{tag} a un meeting.", { tag: group.label })}
            </p>
          )}
        </div>

        <div hidden={dim === "recordings" || mode === "items"} className="lib-col lib-preview">
          {bulk ? (
            <>
              <h2>{t("{n} meeting selezionati", { n: selection.length })}</h2>
              <p className="muted small">
                {t("Il progetto e i tag scelti qui valgono per tutti i meeting selezionati.")}
              </p>
              <select
                className="chip select lib-bulk-project"
                value={selectionProject}
                aria-label={t("Progetto dei meeting selezionati")}
                onChange={(e) => moveSelection(e.target.value || null)}
              >
                {selectionProject === "mixed" && <option value="mixed">{t("Progetti diversi")}</option>}
                <option value="">{t("Nessun progetto")}</option>
                {projects
                  .filter((p) => !p.archived || p.id === selectionProject)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
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
                  aria-label={t("Tag da aggiungere ai meeting selezionati")}
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
                        aria-label={t("Togli #{tag} dai meeting selezionati", { tag: g.label })}
                        title={t("Togli #{tag} dai meeting selezionati", { tag: g.label })}
                        onClick={() => tagSelection([], [g.key])}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </p>
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
                  {projectOf(current)!.name}
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
              <button className="btn small" onClick={() => onOpen(current.id)}>
                {t("Apri il meeting")}
              </button>
              <p className="muted small lib-hint">
                {t(
                  "⌘ clic o Maiusc clic su altri meeting: li selezioni insieme per dare loro un progetto o un tag.",
                )}
              </p>
            </>
          ) : (
            <p className="muted small">{t("Scegli un meeting per vederne l'anteprima.")}</p>
          )}
        </div>
      </div>
      {editing && (
        <ProjectDialog
          project={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, all) => {
            setEditing(null);
            onProjectsChanged(all);
            setDim("projects");
            setGroupKey(saved.id);
          }}
        />
      )}
    </div>
  );
}
