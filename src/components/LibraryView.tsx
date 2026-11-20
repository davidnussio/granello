import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { Meeting, MeetingSummary, Project } from "../types";
import { dayLabel, time } from "../format";
import { locale, t } from "../i18n";
import { sparkle } from "../sparkles";

interface Props {
  /** Progetto da cui partire (aperto dalla barra laterale). */
  project?: string;
  projects: Project[];
  onProjectsChanged: (projects: Project[]) => void;
  onOpen: (meetingId: string) => void;
  toast: (text: string) => void;
}

type Dim = "projects" | "people" | "tags" | "period";

/** Una voce della seconda colonna: un progetto, una persona, un tag o un periodo, con i suoi meeting. */
interface Group {
  key: string;
  label: string;
  meetings: MeetingSummary[];
  archived?: boolean;
}

const DIMS: { id: Dim; icon: string; label: () => string }[] = [
  { id: "projects", icon: "▣", label: () => t("Progetti") },
  { id: "people", icon: "☺", label: () => t("Persone") },
  { id: "tags", icon: "#", label: () => t("Tag") },
  { id: "period", icon: "▦", label: () => t("Periodo") },
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
  return [...map.values()].sort((a, b) => b.meetings.length - a.meetings.length || a.label.localeCompare(b.label));
}

/** Questa settimana, poi un gruppo per mese, dal più recente. */
function byPeriod(meetings: MeetingSummary[]): Group[] {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).getTime();
  const month = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" });
  const out: Group[] = [];
  const week = meetings.filter((m) => m.createdAt >= monday);
  if (week.length) out.push({ key: "week", label: t("Questa settimana"), meetings: week });
  const months = new Map<string, Group>();
  for (const m of meetings) {
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = month.format(d);
    const group = months.get(key) ?? { key, label: label.charAt(0).toUpperCase() + label.slice(1), meetings: [] };
    group.meetings.push(m);
    months.set(key, group);
  }
  return [...out, ...[...months.values()].sort((a, b) => b.key.localeCompare(a.key))];
}

/** Ciò che l'anteprima mostra di un meeting, ricavato dalle sue note. */
function digest(meeting: Meeting) {
  const md = (meeting.enhancedMd?.trim() || meeting.notesMd)
    // i blocchi fatti di dati (citazioni, sondaggi, lavagne…) si contano, non si leggono in anteprima
    .replace(/^[ \t>]*:{3,} *(quote|moment|poll|kanban|timeline|pros-cons|matrix)\b[\s\S]*?^[ \t>]*:{3,} *$/gm, "");
  const lines = md
    .split("\n")
    .map((l) => l.trim())
    // i blocchi dell'editor (::: …, recinti di codice, tabelle) non sono testo da leggere in anteprima
    .filter((l) => l && !/^(:{3,}|```|\||\[\[|!\[)/.test(l))
    .map((l) => l.replace(/^(#{1,6}|[-*+]|\d+\.|>)\s+/, "").replace(/^\[[ xX]\]\s+/, "").replace(/[*_`=]{1,2}/g, ""))
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

export default function LibraryView({ project, projects, onProjectsChanged, onOpen, toast }: Props) {
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [dim, setDim] = useState<Dim>("projects");
  const [groupKey, setGroupKey] = useState<string | null>(project ?? null);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [detail, setDetail] = useState<Meeting | null>(null);
  /** Colonna che riceve le frecce: 0 dimensione, 1 valori, 2 meeting. */
  const [col, setCol] = useState(project ? 2 : 1);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listMeetings().then(setMeetings).catch((e) => toast(errorText(e)));
  }, [toast]);

  // aperta dalla barra laterale su un progetto: si parte da lì
  useEffect(() => {
    if (!project) return;
    setDim("projects");
    setGroupKey(project);
    setCol(2);
  }, [project]);

  const groups = useMemo<Group[]>(() => {
    const isProject = new Map(projects.map((p) => [p.tag, p]));
    if (dim === "people") return groupBy(meetings, (m) => m.attendees);
    if (dim === "period") return byPeriod(meetings);
    const tags = groupBy(meetings, (m) => m.tags);
    if (dim === "tags") return tags.filter((g) => !isProject.has(g.key));
    // un progetto resta in elenco anche prima di avere meeting
    return projects
      .filter((p) => showArchived || !p.archived || p.tag === groupKey)
      .map((p) => ({ key: p.tag, label: p.tag, meetings: tags.find((g) => g.key === p.tag)?.meetings ?? [], archived: p.archived }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.label.localeCompare(b.label));
  }, [dim, meetings, projects, showArchived, groupKey]);

  const group = groups.find((g) => g.key === groupKey) ?? groups[0] ?? null;

  const listed = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const items = (group?.meetings ?? []).filter(
      (m) => !q || [m.title, ...m.attendees, ...m.tags].some((s) => s.toLowerCase().includes(q)),
    );
    return [...items].sort((a, b) => (oldestFirst ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [group, filter, oldestFirst]);

  const current = listed.find((m) => m.id === meetingId) ?? listed[0] ?? null;

  useEffect(() => {
    setDetail(null);
    if (!current) return;
    let alive = true;
    api
      .getMeeting(current.id)
      .then((d) => alive && setDetail(d.meeting))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [current?.id]);

  const setProject = useCallback(
    async (tag: string, archived: boolean | null) => {
      try {
        onProjectsChanged(await api.setProject(tag, archived));
        if (archived === false) {
          setDim("projects");
          setGroupKey(tag);
        }
      } catch (e) {
        toast(errorText(e));
      }
    },
    [onProjectsChanged, toast],
  );

  // frecce: su e giù nella colonna, destra e sinistra tra le colonne, Invio apre il meeting
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT" && e.key !== "ArrowDown" && e.key !== "Escape") return;
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const move = <T,>(items: T[], index: number): T | undefined =>
      items[Math.min(items.length - 1, Math.max(0, index + step))];
    if (step) {
      e.preventDefault();
      if ((e.target as HTMLElement).tagName === "INPUT") {
        setCol(2);
        root.current?.focus();
        return;
      }
      if (col === 0) {
        const next = move(DIMS, DIMS.findIndex((d) => d.id === dim));
        if (next) {
          setDim(next.id);
          setGroupKey(null);
        }
      } else if (col === 1) setGroupKey(move(groups, group ? groups.indexOf(group) : -1)?.key ?? null);
      else setMeetingId(move(listed, current ? listed.indexOf(current) : -1)?.id ?? null);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setCol((c) => Math.min(2, c + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setCol((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      onOpen(current.id);
    } else if (e.key === "Escape") {
      root.current?.focus();
    }
  };

  // la riga selezionata resta in vista mentre si scorre con le frecce
  useEffect(() => {
    root.current?.querySelectorAll(".lib-row.on, .lib-meeting.on").forEach((el) => el.scrollIntoView({ block: "nearest" }));
  }, [dim, group?.key, current?.id]);

  useEffect(() => root.current?.focus(), []);

  const archivedCount = projects.filter((p) => p.archived).length;
  const info = detail && current && detail.id === current.id ? digest(detail) : null;
  const facts = info
    ? [
        info.openTasks ? (info.openTasks === 1 ? t("1 azione aperta") : t("{n} azioni aperte", { n: info.openTasks })) : null,
        info.quotes ? (info.quotes === 1 ? t("1 citazione") : t("{n} citazioni", { n: info.quotes })) : null,
        info.moments ? (info.moments === 1 ? t("1 momento segnato") : t("{n} momenti segnati", { n: info.moments })) : null,
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
        <button className="btn small ghost" onClick={() => setOldestFirst((v) => !v)} title={t("Cambia l'ordine dei meeting")}>
          {oldestFirst ? t("↑ Più vecchi") : t("↓ Più recenti")}
        </button>
      </header>

      <div className="lib-cols">
        <div className={"lib-col" + (col === 0 ? " focus" : "")} role="listbox" aria-label={t("Raggruppa per")}>
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

        <div className={"lib-col" + (col === 1 ? " focus" : "")} role="listbox" aria-label={DIMS.find((d) => d.id === dim)!.label()}>
          {groups.map((g) => (
            <div key={g.key} className={"lib-row" + (g.key === group?.key ? " on" : "") + (g.archived ? " archived" : "")}>
              <button
                role="option"
                aria-selected={g.key === group?.key}
                className="lib-row-main"
                onClick={() => {
                  setGroupKey(g.key);
                  setCol(1);
                }}
              >
                <span className="lib-label">
                  {dim === "tags" || dim === "projects" ? "#" : ""}
                  {g.label}
                </span>
                <span className="lib-count">{g.meetings.length}</span>
              </button>
              {dim === "tags" && (
                <button className="lib-act" onClick={() => setProject(g.key, false)} title={t("Rendi questo tag un progetto")}>
                  {t("Progetto")}
                </button>
              )}
              {dim === "projects" && (
                <>
                  <button
                    className="lib-act"
                    onClick={() => setProject(g.key, !g.archived)}
                    title={g.archived ? t("Riporta il progetto tra quelli attivi") : t("Archivia: il progetto è chiuso, i meeting restano")}
                  >
                    {g.archived ? t("Riattiva") : t("Archivia")}
                  </button>
                  <button className="lib-act" onClick={() => setProject(g.key, null)} title={t("Torna un tag normale: i meeting restano")}>
                    ×
                  </button>
                </>
              )}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="muted small lib-empty">
              {dim === "projects"
                ? t("Nessun progetto. In Tag, passa su un tag e scegli Progetto.")
                : dim === "tags"
                  ? t("Nessun tag: aggiungine uno a un meeting, sotto il titolo.")
                  : dim === "people"
                    ? t("Nessun partecipante nei meeting.")
                    : t("Ancora nessun meeting")}
            </p>
          )}
          {dim === "projects" && archivedCount > 0 && (
            <button className="lib-more" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? t("Nascondi archiviati") : t("Archiviati ({n})", { n: archivedCount })}
            </button>
          )}
        </div>

        <div className={"lib-col lib-meetings" + (col === 2 ? " focus" : "")} role="listbox" aria-label={t("Meeting")}>
          {listed.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={m.id === current?.id}
              className={"lib-meeting" + (m.id === current?.id ? " on" : "")}
              onClick={() => {
                setMeetingId(m.id);
                setCol(2);
              }}
              onDoubleClick={() => onOpen(m.id)}
            >
              <span className="lib-meeting-title">{m.title || t("Senza titolo")}</span>
              <span className="lib-meeting-meta">
                {dayLabel(m.createdAt)}
                {m.attendees.length ? ` · ${m.attendees.slice(0, 3).join(", ")}${m.attendees.length > 3 ? "…" : ""}` : ""}
                {m.hasEnhanced && sparkle(" · ✦")}
              </span>
            </button>
          ))}
          {group && listed.length === 0 && (
            <p className="muted small lib-empty">
              {filter ? t("Nessun risultato") : t("Nessun meeting qui: aggiungi il tag #{tag} a un meeting.", { tag: group.label })}
            </p>
          )}
        </div>

        <div className="lib-col lib-preview">
          {current ? (
            <>
              <h2>{current.title || t("Senza titolo")}</h2>
              <p className="muted small">
                {dayLabel(current.createdAt)} · {time(current.createdAt)}
              </p>
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
            </>
          ) : (
            <p className="muted small">{t("Scegli un meeting per vederne l'anteprima.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
