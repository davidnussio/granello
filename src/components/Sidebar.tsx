import type { RefObject } from "react";
import type { CalendarEvent, MeetingSummary, RecordingStatus, View } from "../types";
import { groupByDay, time } from "../format";
import { t } from "../i18n";

interface Props {
  view: View;
  setView: (v: View) => void;
  query: string;
  setQuery: (q: string) => void;
  meetings: MeetingSummary[];
  events: CalendarEvent[];
  rec: RecordingStatus;
  onNew: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  searchRef: RefObject<HTMLInputElement>;
}

export default function Sidebar(p: Props) {
  const now = Date.now();
  const soon = p.events.filter((e) => e.end > now && e.start < now + 18 * 3600_000).slice(0, 4);
  const selectedId = p.view.kind === "meeting" ? p.view.id : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="btn primary wide" onClick={p.onNew} title={t("Nuove note (⌘N)")}>
          {t("+ Nuove note")}
        </button>
        <input
          className="search"
          ref={p.searchRef}
          type="search"
          aria-label={t("Cerca nei meeting")}
          placeholder={t("Cerca nei meeting…  ⌘K")}
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
        />
      </div>

      <nav className="nav">
        <button className={navCls(p.view.kind === "home")} onClick={() => p.setView({ kind: "home" })}>
          ⌂ Home
        </button>
        <button className={navCls(p.view.kind === "chat")} onClick={() => p.setView({ kind: "chat" })}>
          {t("✦ Chiedi ai meeting")}
        </button>
      </nav>

      {soon.length > 0 && !p.query && (
        <section className="side-section">
          <h4>{t("In arrivo")}</h4>
          {soon.map((e) => (
            <button key={e.id} className="side-item event" onClick={() => p.onOpenEvent(e)}>
              <span className="side-time">{time(e.start)}</span>
              <span className="side-title">{e.title}</span>
              {e.start <= now && e.end > now && <span className="live-dot" title={t("In corso")} />}
            </button>
          ))}
        </section>
      )}

      <div className="side-list">
        {p.meetings.length === 0 && (
          <p className="muted small pad">{p.query ? t("Nessun risultato") : t("Ancora nessun meeting")}</p>
        )}
        {groupByDay(p.meetings, (m) => m.createdAt).map(([day, items]) => (
          <section key={day} className="side-section">
            <h4>{day}</h4>
            {items.map((m) => (
              <button
                key={m.id}
                className={"side-item" + (m.id === selectedId ? " active" : "")}
                onClick={() => p.setView({ kind: "meeting", id: m.id })}
              >
                <span className="side-title">
                  {p.rec.meetingId === m.id && <span className="rec-dot" />}
                  {m.title}
                </span>
                {m.snippet ? (
                  <span className="side-snippet" dangerouslySetInnerHTML={{ __html: highlight(m.snippet) }} />
                ) : (
                  <span className="side-meta">
                    {time(m.createdAt)}
                    {m.hasEnhanced ? " · ✦" : ""}
                    {m.attendees.length ? ` · ${t("{n} persone", { n: m.attendees.length })}` : ""}
                  </span>
                )}
              </button>
            ))}
          </section>
        ))}
      </div>

      {p.rec.meetingId && p.rec.meetingId !== selectedId && (
        <button
          className="rec-pill"
          title={t("Apri il meeting in registrazione")}
          onClick={() => p.setView({ kind: "meeting", id: p.rec.meetingId! })}
        >
          {t("● Registrazione in corso")}
        </button>
      )}

      <div className="sidebar-bottom">
        <button className={navCls(p.view.kind === "templates")} onClick={() => p.setView({ kind: "templates" })}>
          {t("☰ Template")}
        </button>
        <button className={navCls(p.view.kind === "settings")} onClick={() => p.setView({ kind: "settings" })}>
          {t("⚙ Impostazioni")}
        </button>
      </div>
    </aside>
  );
}

function navCls(active: boolean) {
  return "nav-item" + (active ? " active" : "");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function highlight(snippet: string) {
  return escapeHtml(snippet).replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}
