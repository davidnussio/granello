import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, on } from "./api";
import type { CalendarEvent, MeetingSummary, RecordingStatus, View } from "./types";
import Sidebar from "./components/Sidebar";
import MeetingView from "./components/MeetingView";
import ChatPanel from "./components/ChatPanel";
import SettingsView from "./components/SettingsView";
import TemplatesView from "./components/TemplatesView";
import Home from "./components/Home";
import { getLang, resolveLang, setLang, t } from "./i18n";

export interface SetupStatus {
  hasKey: boolean;
  hasModel: boolean;
  hasCalendar: boolean;
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export default function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [query, setQuery] = useState("");
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [rec, setRec] = useState<RecordingStatus>({ meetingId: null, recording: false, pendingChunks: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // cambiare lingua ridisegna tutta l'interfaccia: t() legge la lingua corrente
  const [, setLangState] = useState(getLang());
  const applyLang = useCallback((setting: string) => {
    setLang(resolveLang(setting));
    setLangState(getLang());
  }, []);
  useEffect(() => {
    api.getSettings().then((s) => applyLang(s.uiLanguage)).catch(() => {});
  }, [applyLang]);

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 15000 : 6000);
  }, []);

  const refreshMeetings = useCallback(() => {
    api.listMeetings(query).then(setMeetings).catch((e) => toast(errorText(e)));
  }, [query, toast]);

  const refreshEvents = useCallback(
    (force = false) => {
      api
        .upcomingEvents(force)
        .then(setEvents)
        .catch((e) => {
          if (force) toast(t("Calendario: {error}", { error: errorText(e) }));
        });
    },
    [toast],
  );

  const refreshRec = useCallback(() => {
    api.recordingStatus().then(setRec).catch(() => {});
  }, []);

  const refreshSetup = useCallback(() => {
    Promise.all([api.aiReady(), api.listWhisperModels(), api.getSettings()])
      .then(([hasKey, models, settings]) =>
        setSetup({
          hasKey,
          hasModel: models.some((m) => m.name === settings.whisperModel && m.downloaded),
          hasCalendar: !!settings.icsUrl,
        }),
      )
      .catch(() => {});
  }, []);

  // ricontrolla la configurazione quando si torna dalle impostazioni
  useEffect(() => {
    if (view.kind === "home") refreshSetup();
  }, [view.kind, refreshSetup]);

  useEffect(() => {
    const t = setTimeout(refreshMeetings, 150);
    return () => clearTimeout(t);
  }, [refreshMeetings]);

  useEffect(() => {
    refreshEvents();
    refreshRec();
    const iv = setInterval(() => refreshEvents(), 60_000);
    const offs = [
      on("calendar-updated", () => refreshEvents()),
      on("recording-started", refreshRec),
      on("recording-stopped", refreshRec),
      on("recording-finished", () => {
        refreshRec();
        refreshMeetings();
      }),
      on("transcription-error", (e) => toast(t("Trascrizione: {error}", { error: e.message }))),
      on("recording-warning", (e) => toast(e.message)),
      on("recording-error", (e) => {
        // il dispositivo audio è sparito: la cattura si è già fermata, si chiude la sessione
        toast(t("Registrazione interrotta: {error}. La parte già registrata viene trascritta.", { error: e.message }));
        api.stopRecording().catch(() => {}).finally(refreshRec);
      }),
      on("meeting-starting", (e) =>
        toast(t("Sta per iniziare: {title}", { title: e.title }), { label: t("Prendi note"), run: () => openEvent(e) }),
      ),
    ];
    return () => {
      clearInterval(iv);
      offs.forEach((o) => o());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newMeetingRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === "n") {
        e.preventDefault();
        newMeetingRef.current();
      } else if (e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === ",") {
        e.preventDefault();
        setView({ kind: "settings" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const newMeeting = async () => {
    try {
      const m = await api.createMeeting({ title: "" });
      setView({ kind: "meeting", id: m.id });
      refreshMeetings();
    } catch (e) {
      toast(errorText(e));
    }
  };

  newMeetingRef.current = newMeeting;

  const openEvent = async (e: CalendarEvent) => {
    try {
      const m = e.meetingId
        ? { id: e.meetingId }
        : await api.createMeeting({ title: e.title, calendarEventId: e.id, attendees: e.attendees });
      setView({ kind: "meeting", id: m.id });
      refreshMeetings();
      refreshEvents();
    } catch (err) {
      toast(errorText(err));
    }
  };

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region />
      <Sidebar
        view={view}
        setView={setView}
        query={query}
        setQuery={setQuery}
        meetings={meetings}
        events={events}
        rec={rec}
        onNew={newMeeting}
        onOpenEvent={openEvent}
        searchRef={searchRef}
      />
      <main className="main">
        {view.kind === "home" && (
          <Home
            events={events}
            setup={setup}
            onNew={newMeeting}
            onOpenEvent={openEvent}
            onRefresh={() => refreshEvents(true)}
            onOpenSettings={() => setView({ kind: "settings" })}
          />
        )}
        {view.kind === "meeting" && (
          <MeetingView
            key={view.id}
            id={view.id}
            rec={rec}
            toast={toast}
            onChanged={refreshMeetings}
            onRecChanged={refreshRec}
            onDeleted={() => {
              setView({ kind: "home" });
              refreshMeetings();
            }}
          />
        )}
        {view.kind === "chat" && (
          <ChatPanel
            scope="global"
            toast={toast}
            big
            title={t("Chiedi a tutti i tuoi meeting")}
            subtitle={t("Granello cerca i meeting più pertinenti alla domanda e risponde citando titolo e data.")}
            suggestions={[
              t("Quali azioni sono rimaste aperte questa settimana?"),
              t("Cosa abbiamo deciso nell'ultimo meeting con il cliente?"),
              t("Riassumi i temi ricorrenti degli standup"),
            ]}
          />
        )}
        {view.kind === "settings" && (
          <SettingsView
            toast={toast}
            onCalendarChanged={() => refreshEvents(true)}
            onLangChanged={(l) => {
              applyLang(l);
              refreshMeetings();
            }}
          />
        )}
        {view.kind === "templates" && <TemplatesView toast={toast} />}
      </main>
      <div className="toasts">
        {toasts.map((item) => (
          <div key={item.id} className="toast" role="status">
            <span>{item.text}</span>
            {item.action && (
              <button
                className="btn small primary"
                onClick={() => {
                  item.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== item.id));
                }}
              >
                {item.action.label}
              </button>
            )}
            <button
              className="toast-x"
              aria-label={t("Chiudi notifica")}
              onClick={() => setToasts((x) => x.filter((y) => y.id !== item.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
