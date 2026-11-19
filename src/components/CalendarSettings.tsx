import { useEffect, useState } from "react";
import type { Calendar } from "../types";
import { t } from "../i18n";

interface Props {
  calendars: Calendar[];
  /** Salva l'elenco; false se le impostazioni lo hanno rifiutato. */
  onSave: (calendars: Calendar[]) => Promise<boolean>;
}

const MAX_CALENDARS = 12;

/** Elenco dei calendari iCal: nome, indirizzo, attivo o no. Si salva da solo come il resto delle impostazioni. */
export default function CalendarSettings({ calendars, onSave }: Props) {
  // le righe appena aggiunte restano qui finché non hanno un indirizzo: senza non si possono salvare
  const [rows, setRows] = useState<Calendar[]>(calendars);

  useEffect(() => {
    setRows((prev) => [...calendars, ...prev.filter((r) => !r.url.trim() && !calendars.some((c) => c.id === r.id))]);
  }, [calendars]);

  const commit = (next: Calendar[]) => {
    setRows(next);
    const complete = next.filter((r) => r.url.trim());
    const same = JSON.stringify(complete) === JSON.stringify(calendars);
    if (!same) onSave(complete);
  };
  const edit = (id: string, patch: Partial<Calendar>) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r));

  return (
    // non è un .field: il nome del calendario ha lo stile sobrio dei nomi dei provider
    <div className="calendars">
      <span>{t("Calendari (URL iCal)")}</span>
      {rows.map((c) => (
        <div key={c.id} className="provider calendar">
          <div className="row gap">
            <input
              className="provider-name"
              aria-label={t("Nome del calendario")}
              placeholder={t("Nome del calendario")}
              value={c.name}
              maxLength={40}
              onChange={(e) => setRows(edit(c.id, { name: e.target.value }))}
              onBlur={() => commit(rows)}
            />
            <div className="spacer" />
            <label className="calendar-enabled" title={t("Un calendario disattivato resta configurato ma non mostra eventi né notifiche.")}>
              <input
                type="checkbox"
                checked={c.enabled}
                onChange={(e) => commit(edit(c.id, { enabled: e.target.checked }))}
              />
              {t("Attivo")}
            </label>
            <button className="btn small ghost danger" onClick={() => commit(rows.filter((r) => r.id !== c.id))}>
              {t("Rimuovi")}
            </button>
          </div>
          <div className="field">
            <input
              // l'indirizzo iCal è un segreto: resta nascosto, come una password
              type="password"
              autoComplete="off"
              aria-label={t("URL iCal")}
              value={c.url}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              onChange={(e) => setRows(edit(c.id, { url: e.target.value }))}
              onBlur={() => commit(rows)}
            />
          </div>
        </div>
      ))}
      <div>
        <button
          className="btn small"
          disabled={rows.length >= MAX_CALENDARS || rows.some((r) => !r.url.trim())}
          onClick={() => setRows([...rows, { id: crypto.randomUUID(), name: "", url: "", enabled: true }])}
        >
          {t("+ Aggiungi calendario")}
        </button>
      </div>
      <small className="muted">
        {t("Google Calendar: Impostazioni del calendario → \"Indirizzo segreto in formato iCal\". Outlook: Calendario → Pubblica calendario → link ICS.")}
      </small>
    </div>
  );
}
