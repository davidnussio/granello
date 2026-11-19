import type { CalendarEvent } from "../types";
import { groupByDay, time } from "../format";

interface Props {
  events: CalendarEvent[];
  onNew: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onRefresh: () => void;
}

export default function Home({ events, onNew, onOpenEvent, onRefresh }: Props) {
  const now = Date.now();
  const upcoming = events.filter((e) => e.end > now);

  return (
    <div className="page">
      <h1 className="page-title">Ciao 👋</h1>
      <p className="muted">
        Apri un meeting dal calendario o crea note nuove. Scrivi quello che ti sembra importante: Granello trascrive in
        locale e alla fine Claude arricchisce le tue note con la trascrizione.
      </p>
      <div className="row gap" style={{ margin: "20px 0 32px" }}>
        <button className="btn primary" onClick={onNew}>
          + Nuove note
        </button>
        <button className="btn" onClick={onRefresh}>
          ↻ Aggiorna calendario
        </button>
      </div>

      <h3>Prossimi meeting</h3>
      {upcoming.length === 0 && (
        <p className="muted small">
          Nessun evento. Aggiungi l'URL iCal del tuo calendario nelle Impostazioni per vedere qui i meeting.
        </p>
      )}
      {groupByDay(upcoming, (e) => e.start).map(([day, items]) => (
        <section key={day} className="event-day">
          <h4>{day}</h4>
          {items.map((e) => {
            const live = e.start <= now && e.end > now;
            return (
              <div key={e.id} className={"event-card" + (live ? " live" : "")}>
                <div className="event-time">
                  {time(e.start)}
                  <span className="muted"> - {time(e.end)}</span>
                </div>
                <div className="event-body">
                  <div className="event-title">{e.title}</div>
                  {e.attendees.length > 0 && (
                    <div className="muted small ellipsis">{e.attendees.slice(0, 5).join(", ")}{e.attendees.length > 5 ? ` +${e.attendees.length - 5}` : ""}</div>
                  )}
                </div>
                <button className={"btn small" + (live ? " primary" : "")} onClick={() => onOpenEvent(e)}>
                  {e.meetingId ? "Apri note" : "Prendi note"}
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
