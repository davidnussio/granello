import { useState, type RefObject } from "react";
import { sparkle } from "../sparkles";
import type { CalendarEvent, MeetingSummary, RecordingStatus, Vault, View } from "../types";
import { shortWhen, time, weekdayTime } from "../format";
import { t } from "../i18n";

interface Props {
  view: View;
  setView: (v: View) => void;
  query: string;
  setQuery: (q: string) => void;
  /** Tutte le note del vault aperto, dalla più recente. */
  meetings: MeetingSummary[];
  /** I risultati della ricerca in corso; vuoto a campo vuoto. */
  results: MeetingSummary[];
  events: CalendarEvent[];
  rec: RecordingStatus;
  onNew: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  searchRef: RefObject<HTMLInputElement>;
  vaults: Vault[];
  onOpenVault: (id: string) => void;
}

/** Quante note mostra una settimana prima di «Altre N». */
const PER_WEEK = 4;

/** Dove cominciano oggi, ieri, questa settimana (da lunedì) e la settimana scorsa. */
function bounds(now: number) {
  const d = new Date(now);
  const day = (n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  const monday = -((d.getDay() + 6) % 7);
  return { today: day(0), yesterday: day(-1), monday: day(monday), lastMonday: day(monday - 7) };
}
export default function Sidebar(p: Props) {
  const now = Date.now();
  const soon = p.events.filter((e) => e.end > now && e.start < now + 18 * 3600_000).slice(0, 4);
  const selectedId = p.view.kind === "meeting" ? p.view.id : null;
  // nell'ordine in cui sono stati fissati: un meeting nuovo non sposta quelli già in cima
  const pinned = p.meetings.filter((m) => m.pinnedAt !== null).toSorted((a, b) => a.pinnedAt! - b.pinnedAt!);
  /** Le settimane aperte con «Altre N»: tornano chiuse alla prossima apertura dell'app. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // le note per giorno e settimana dell'ultima modifica, dalla più recente: chi ha appena
  // ritoccato una nota vecchia la ritrova in cima. Oggi e ieri non tornano nelle settimane
  const b = bounds(now);
  const changed = p.meetings.toSorted((x, y) => y.updatedAt - x.updatedAt);
  const today = changed.filter((m) => m.updatedAt >= b.today);
  const yesterday = changed.filter((m) => m.updatedAt >= b.yesterday && m.updatedAt < b.today);
  const thisWeek = changed.filter((m) => m.updatedAt >= b.monday && m.updatedAt < b.yesterday);
  const lastWeek = changed.filter(
    (m) => m.updatedAt >= b.lastMonday && m.updatedAt < Math.min(b.monday, b.yesterday),
  );

  /** Una nota di una settimana: titolo e, a destra, giorno e ora dell'ultima modifica. */
  const row = (m: MeetingSummary) => (
    <button
      key={m.id}
      className={"side-item side-row" + (m.id === selectedId ? " active" : "")}
      onClick={() => p.setView({ kind: "meeting", id: m.id })}
      title={m.hasEnhanced ? undefined : t("Note non ancora rielaborate")}
    >
      <span className={"side-title" + (m.hasEnhanced ? "" : " draft")}>
        {p.rec.meetingId === m.id && <span className="rec-dot" />}
        {m.title || t("Senza titolo")}
      </span>
      <span className="side-time">{weekdayTime(m.updatedAt)}</span>
    </button>
  );

  /**
   * Una nota di oggi o di ieri: titolo e, a destra, l'ora dell'ultima modifica, come nelle
   * settimane; sotto ✦ se rielaborata e quante persone, poi i tag.
   */
  const card = (m: MeetingSummary) => {
    const people =
      m.attendees.length === 1
        ? t("1 persona")
        : m.attendees.length > 1
          ? t("{n} persone", { n: m.attendees.length })
          : "";
    const meta = [m.hasEnhanced ? "✦" : "", people].filter(Boolean).join(" · ");
    return (
      <button
        key={m.id}
        className={"side-item side-card" + (m.id === selectedId ? " active" : "")}
        onClick={() => p.setView({ kind: "meeting", id: m.id })}
        title={m.hasEnhanced ? undefined : t("Note non ancora rielaborate")}
      >
        <span className="side-card-head">
          <span className={"side-title" + (m.hasEnhanced ? "" : " draft")}>
            {p.rec.meetingId === m.id && <span className="rec-dot" />}
            {m.title || t("Senza titolo")}
          </span>
          <span className="side-time">{time(m.updatedAt)}</span>
        </span>
        {meta && <span className="side-meta">{sparkle(meta)}</span>}
        <Tags tags={m.tags} />
      </button>
    );
  };

  const day = (title: string, list: MeetingSummary[]) =>
    list.length > 0 && (
      <section className="side-section" aria-label={title}>
        <h4 className="side-head">
          <span>{title}</span>
          <span className="side-count">{list.length}</span>
        </h4>
        {list.map(card)}
      </section>
    );

  /** Una settimana: righe compatte con giorno e ora, le prime quattro e poi «Altre N». */
  const week = (id: string, title: string, more: string, list: MeetingSummary[]) => {
    if (list.length === 0) return null;
    const all = expanded.has(id);
    return (
      <section className="side-section" aria-label={title}>
        <h4 className="side-head">
          <span>{title}</span>
          <span className="side-count">{list.length}</span>
        </h4>
        {(all ? list : list.slice(0, PER_WEEK)).map(row)}
        {list.length > PER_WEEK && (
          <button
            className="side-item side-more"
            aria-expanded={all}
            onClick={() => {
              const next = new Set(expanded);
              if (!next.delete(id)) next.add(id);
              setExpanded(next);
            }}
          >
            {all ? t("Mostra meno") : more}
          </button>
        )}
      </section>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="btn primary wide" onClick={p.onNew} title={t("Nuova nota (⌘N)")}>
          {t("+ Nuova nota")}
        </button>
        <input
          className="search"
          ref={p.searchRef}
          type="search"
          aria-label={t("Cerca nelle note")}
          placeholder={t("Cerca nelle note…  ⌘K")}
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
        />
      </div>

      <nav className="nav">
        <button className={navCls(p.view.kind === "home")} onClick={() => p.setView({ kind: "home" })}>
          ⌂ Home
        </button>
        <button className={navCls(p.view.kind === "chat")} onClick={() => p.setView({ kind: "chat" })}>
          {sparkle(t("✦ Chiedi alle note"))}
        </button>
        <button
          className={navCls(p.view.kind === "library")}
          onClick={() => p.setView({ kind: "library" })}
          title={t("Sfoglia le note per progetto, gruppo, persona, tag e periodo")}
        >
          {t("▤ Libreria")}
        </button>
        <button
          className={navCls(p.view.kind === "people")}
          onClick={() => p.setView({ kind: "people" })}
          title={t("Le persone delle tue note e i loro gruppi")}
        >
          {t("☺ Persone")}
        </button>
      </nav>

      <div className="side-list">
        {p.query.trim() ? (
          // durante una ricerca l'elenco è dei risultati: le sezioni tornano a ricerca finita
          <SearchResults {...p} selectedId={selectedId} />
        ) : (
          <>
            {soon.length > 0 && (
              <section className="side-section">
                <h4 className="side-head">
                  <span>{t("In arrivo")}</span>
                  <span className="side-count">{soon.length}</span>
                </h4>
                {soon.map((e) => (
                  <button key={e.id} className="side-item event" onClick={() => p.onOpenEvent(e)}>
                    <span className="side-time">{time(e.start)}</span>
                    <span className="side-title">{e.title}</span>
                    {e.start <= now && e.end > now && <span className="live-dot" title={t("In corso")} />}
                  </button>
                ))}
              </section>
            )}

            {pinned.length > 0 && (
              <section className="side-section" aria-label={t("Fissati")}>
                <h4>{t("Fissati")}</h4>
                {pinned.map((m) => (
                  <button
                    key={m.id}
                    className={"side-item pinned" + (m.id === selectedId ? " active" : "")}
                    onClick={() => p.setView({ kind: "meeting", id: m.id })}
                  >
                    <span className="side-title">
                      {p.rec.meetingId === m.id && <span className="rec-dot" />}
                      {m.title || t("Senza titolo")}
                    </span>
                  </button>
                ))}
              </section>
            )}

            {day(t("Oggi"), today)}
            {day(t("Ieri"), yesterday)}
            {week(
              "this",
              t("Questa settimana"),
              t("Altre {n} di questa settimana", { n: thisWeek.length - PER_WEEK }),
              thisWeek,
            )}
            {week(
              "last",
              t("Settimana scorsa"),
              t("Altre {n} della settimana scorsa", { n: lastWeek.length - PER_WEEK }),
              lastWeek,
            )}

            {p.meetings.length === 0 ? (
              <p className="muted small pad">{t("Ancora nessuna nota")}</p>
            ) : (
              <button className="side-all" onClick={() => p.setView({ kind: "library", all: true })}>
                <span>{t("Tutte le note")}</span>
                <span className="side-count">
                  {p.meetings.length} <span aria-hidden="true">›</span>
                </span>
              </button>
            )}
          </>
        )}
      </div>

      {p.rec.meetingId && p.rec.meetingId !== selectedId && (
        <button
          className="rec-pill"
          title={p.rec.importing ? t("Apri la nota in trascrizione") : t("Apri la nota in registrazione")}
          onClick={() => p.setView({ kind: "meeting", id: p.rec.meetingId! })}
        >
          {p.rec.importing ? t("● Trascrizione del file in corso") : t("● Registrazione in corso")}
        </button>
      )}

      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => p.setView({ kind: "settings" })}>
          {t("⚙ Impostazioni")}
        </button>
        {/* con un vault solo non c'è niente da scegliere. Il menu è quello di sistema: il
            select sta, invisibile, sopra l'icona */}
        {p.vaults.length > 1 && (
          <label
            className="vault-switch"
            title={t("Vault aperto: {name}. Scegline un altro per aprirlo.", {
              name: p.vaults.find((v) => v.active)?.name ?? "",
            })}
          >
            <span aria-hidden="true">◫</span>
            <select
              value={p.vaults.find((v) => v.active)?.id ?? ""}
              aria-label={t("Vault aperto")}
              onChange={(e) => p.onOpenVault(e.target.value)}
            >
              {p.vaults.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.available}>
                  {v.name}
                  {v.available ? "" : ` · ${t("non disponibile")}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </aside>
  );
}

/**
 * I risultati di una ricerca, con il pezzo di testo che corrisponde. Restano nell'ordine di
 * pertinenza, senza gruppi per giorno: lo stesso giorno tornerebbe in più punti dell'elenco.
 */
function SearchResults(p: Props & { selectedId: string | null }) {
  if (p.results.length === 0) return <p className="muted small pad">{t("Nessun risultato")}</p>;
  return (
    <section className="side-section">
      <h4>{t("Risultati")}</h4>
      {p.results.map((m) => (
        <button
          key={m.id}
          className={"side-item" + (m.id === p.selectedId ? " active" : "")}
          onClick={() => p.setView({ kind: "meeting", id: m.id })}
        >
          <span className="side-result-head">
            <span className="side-title">
              {p.rec.meetingId === m.id && <span className="rec-dot" />}
              {m.title || t("Senza titolo")}
            </span>
            <span className="side-time">{shortWhen(m.createdAt)}</span>
          </span>
          {m.snippet ? (
            <span className="side-snippet" dangerouslySetInnerHTML={{ __html: highlight(m.snippet) }} />
          ) : (
            <span className="side-meta">
              {m.hasEnhanced && sparkle("✦ ")}
              {m.attendees.length ? t("{n} persone", { n: m.attendees.length }) : ""}
            </span>
          )}
          <Tags tags={m.tags} />
        </button>
      ))}
    </section>
  );
}

/** I tag di una nota, al massimo due: la riga deve restare leggibile. */
function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="side-tags">
      {tags.slice(0, 2).map((tag) => (
        <span key={tag} className="side-tag">
          #{tag}
        </span>
      ))}
      {tags.length > 2 && (
        <span
          className="side-tag more"
          title={tags
            .slice(2)
            .map((x) => "#" + x)
            .join(" ")}
        >
          +{tags.length - 2}
        </span>
      )}
    </span>
  );
}

function navCls(active: boolean) {
  return "nav-item" + (active ? " active" : "");
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function highlight(snippet: string) {
  return escapeHtml(snippet).replace(/«/g, "<mark>").replace(/»/g, "</mark>");
}
