import type { CalendarEvent, CalendarInfo } from "../types";
import DemoButton, { type Demo } from "./DemoData";
import type { SetupStatus } from "../App";
import { groupByDay, time } from "../format";
import { t } from "../i18n";

interface Props {
  events: CalendarEvent[];
  calendars: CalendarInfo[];
  /** Mostra o nasconde un calendario nel vault aperto. */
  onToggleCalendar: (id: string, shown: boolean) => void;
  onNew: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onRefresh: () => void;
  setup: SetupStatus | null;
  demo: Demo;
  /** La scheda dei dati di esempio è stata chiusa. */
  demoHidden: boolean;
  onHideDemo: () => void;
  onOpenSettings: () => void;
}

export default function Home({
  events,
  calendars,
  onToggleCalendar,
  onNew,
  onOpenEvent,
  onRefresh,
  setup,
  demo,
  demoHidden,
  onHideDemo,
  onOpenSettings,
}: Props) {
  const now = Date.now();
  const upcoming = events.filter((e) => e.end > now);
  // un calendario spento nelle impostazioni non c'è in nessun vault; gli altri si scelgono qui
  const usable = calendars.filter((c) => c.enabled);
  const active = usable.filter((c) => c.shown);
  // da quale calendario arriva un evento interessa solo se ce n'è più di uno attivo
  const calendarName = (id: string) =>
    active.length > 1 ? calendars.find((c) => c.id === id)?.name : undefined;

  return (
    <div className="page">
      <h1 className="page-title">{t("Ciao 👋")}</h1>
      <p className="muted">
        {t(
          "Apri un evento dal calendario o crea una nota nuova. Scrivi quello che ti sembra importante: Granello trascrive in locale e alla fine l'AI arricchisce le tue note con la trascrizione.",
        )}
      </p>
      <div className="row gap" style={{ margin: "20px 0 32px" }}>
        <button className="btn primary" onClick={onNew}>
          {t("+ Nuova nota")}
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
                {setup.hasModel
                  ? t("Scaricato")
                  : t("Serve per registrare: scaricalo una volta, poi funziona offline.")}
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
                {setup.hasCalendar ? t("Collegato") : t("Facoltativo: mostra qui i prossimi eventi.")}
              </span>
            </li>
          </ul>
          <button className="btn primary small" onClick={onOpenSettings}>
            {t("Apri le impostazioni")}
          </button>
        </section>
      )}

      {!demoHidden && (
        <section className="card demo-card">
          <div>
            <h3>{demo.count ? t("Stai vedendo i dati di esempio") : t("Vuoi vedere cosa sa fare?")}</h3>
            <p className="muted small">
              {demo.count
                ? t(
                    "{n} note inventate, con trascrizioni e progetti. Quando hai finito di esplorare puoi toglierle: le tue note restano.",
                    { n: demo.count },
                  )
                : t(
                    "Carica qualche nota inventata ma realistica: tutti i blocchi dell'editor, trascrizioni, note AI e progetti nella Libreria. Si tolgono con un clic.",
                  )}
            </p>
          </div>
          <DemoButton demo={demo} primary={demo.count === 0} />
          <button
            className="demo-close"
            onClick={onHideDemo}
            aria-label={t("Chiudi")}
            title={t("Chiudi: i dati di esempio restano in Impostazioni → Dati e privacy")}
          >
            ×
          </button>
        </section>
      )}

      <h3>{t("Prossimi eventi")}</h3>
      {usable.length > 0 && (
        <div className="calendar-toggles" role="group" aria-label={t("Calendari")}>
          {usable.map((c) => (
            <button
              key={c.id}
              className={"chip calendar-toggle" + (c.shown ? " on" : "") + (c.error ? " failed" : "")}
              aria-pressed={c.shown}
              onClick={() => onToggleCalendar(c.id, !c.shown)}
              title={
                c.error
                  ? t("Aggiornamento non riuscito: {error}", { error: c.error })
                  : c.shown
                    ? t("Nascondi gli eventi di questo calendario in questo vault")
                    : t("Mostra gli eventi di questo calendario in questo vault")
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
            ? t(
                "Nessun evento. Aggiungi l'URL iCal del tuo calendario nelle Impostazioni per vedere qui i tuoi eventi.",
              )
            : usable.length === 0
              ? t("Tutti i calendari sono disattivati.")
              : active.length === 0
                ? t("Questo vault non mostra nessun calendario: sceglili qui sopra.")
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
                    {calendarName(e.calendarId) && (
                      <span className="chip tiny event-calendar">{calendarName(e.calendarId)}</span>
                    )}
                  </div>
                  {e.attendees.length > 0 && (
                    <div className="muted small ellipsis">
                      {e.attendees.slice(0, 5).join(", ")}
                      {e.attendees.length > 5 ? ` +${e.attendees.length - 5}` : ""}
                    </div>
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
