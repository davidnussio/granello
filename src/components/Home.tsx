import type { CalendarEvent, CalendarInfo } from "../types";
import type { SetupStatus } from "../App";
import { groupByDay, time } from "../format";
import { t } from "../i18n";

interface Props {
  events: CalendarEvent[];
  calendars: CalendarInfo[];
  onToggleCalendar: (id: string, enabled: boolean) => void;
  onNew: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onRefresh: () => void;
  setup: SetupStatus | null;
  onOpenSettings: () => void;
}

export default function Home({ events, calendars, onToggleCalendar, onNew, onOpenEvent, onRefresh, setup, onOpenSettings }: Props) {
  const now = Date.now();
  const upcoming = events.filter((e) => e.end > now);
  const active = calendars.filter((c) => c.enabled);
  // da quale calendario arriva un evento interessa solo se ce n'è più di uno attivo
  const calendarName = (id: string) => (active.length > 1 ? calendars.find((c) => c.id === id)?.name : undefined);

  return (
    <div className="page">
      <h1 className="page-title">{t("Ciao 👋")}</h1>
      <p className="muted">
        {t("Apri un meeting dal calendario o crea note nuove. Scrivi quello che ti sembra importante: Granello trascrive in locale e alla fine l'AI arricchisce le tue note con la trascrizione.")}
      </p>
      <div className="row gap" style={{ margin: "20px 0 32px" }}>
        <button className="btn primary" onClick={onNew}>
          {t("+ Nuove note")}
        </button>
        <button className="btn" onClick={onRefresh}>
          {t("↻ Aggiorna calendario")}
        </button>
      </div>

      {setup && (!setup.hasKey || !setup.hasModel) && (
        <section className="card setup">
          <h3>{t("Completa la configurazione")}</h3>
          <ul className="checklist">
            <li className={setup.hasModel ? "done" : ""}>
              <strong>{t("Modello di trascrizione")}</strong>
              <span className="muted small">
                {setup.hasModel ? t("Scaricato") : t("Serve per registrare: scaricalo una volta, poi funziona offline.")}
              </span>
            </li>
            <li className={setup.hasKey ? "done" : ""}>
              <strong>{t("Modello AI")}</strong>
              <span className="muted small">
                {setup.hasKey
                  ? t("Configurato")
                  : t("Serve per le note AI e la chat: una API key di Claude oppure un modello locale.")}
              </span>
            </li>
            <li className={setup.hasCalendar ? "done" : "optional"}>
              <strong>{t("Calendario")}</strong>
              <span className="muted small">
                {setup.hasCalendar ? t("Collegato") : t("Facoltativo: mostra qui i prossimi meeting.")}
              </span>
            </li>
          </ul>
          <button className="btn primary small" onClick={onOpenSettings}>
            {t("Apri le impostazioni")}
          </button>
        </section>
      )}

      <h3>{t("Prossimi meeting")}</h3>
      {calendars.length > 0 && (
        <div className="calendar-toggles" role="group" aria-label={t("Calendari")}>
          {calendars.map((c) => (
            <button
              key={c.id}
              className={"chip calendar-toggle" + (c.enabled ? " on" : "") + (c.error ? " failed" : "")}
              aria-pressed={c.enabled}
              onClick={() => onToggleCalendar(c.id, !c.enabled)}
              title={
                c.error
                  ? t("Aggiornamento non riuscito: {error}", { error: c.error })
                  : c.enabled
                    ? t("Nascondi gli eventi di questo calendario")
                    : t("Mostra gli eventi di questo calendario")
              }
            >
              <span className="calendar-dot" />
              {c.name}
              {c.error && " ⚠"}
            </button>
          ))}
        </div>
      )}
      {upcoming.length === 0 && (
        <p className="muted small">
          {calendars.length === 0
            ? t("Nessun evento. Aggiungi l'URL iCal del tuo calendario nelle Impostazioni per vedere qui i meeting.")
            : active.length === 0
              ? t("Tutti i calendari sono disattivati.")
              : t("Nessun evento nei prossimi giorni.")}
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
                  <span className="muted"> – {time(e.end)}</span>
                </div>
                <div className="event-body">
                  <div className="event-title">
                    {e.title}
                    {calendarName(e.calendarId) && <span className="chip tiny event-calendar">{calendarName(e.calendarId)}</span>}
                  </div>
                  {e.attendees.length > 0 && (
                    <div className="muted small ellipsis">{e.attendees.slice(0, 5).join(", ")}{e.attendees.length > 5 ? ` +${e.attendees.length - 5}` : ""}</div>
                  )}
                </div>
                <button className={"btn small" + (live ? " primary" : "")} onClick={() => onOpenEvent(e)}>
                  {e.meetingId ? t("Apri note") : t("Prendi note")}
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
