import { useCallback, useEffect, useState } from "react";
import { api, errorText, on } from "./api";
import type { CalendarEvent, MeetingSummary, RecordingStatus, View } from "./types";
import Sidebar from "./components/Sidebar";
import MeetingView from "./components/MeetingView";
import ChatPanel from "./components/ChatPanel";
import SettingsView from "./components/SettingsView";
import TemplatesView from "./components/TemplatesView";
import Home from "./components/Home";

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
          if (force) toast(`Calendario: ${errorText(e)}`);
        });
    },
    [toast],
  );

  const refreshRec = useCallback(() => {
    api.recordingStatus().then(setRec).catch(() => {});
  }, []);

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
      on("transcription-error", (e) => toast(`Trascrizione: ${e.message}`)),
      on("meeting-starting", (e) =>
        toast(`Sta per iniziare: ${e.title}`, { label: "Prendi note", run: () => openEvent(e) }),
      ),
    ];
    return () => {
      clearInterval(iv);
      offs.forEach((o) => o());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      />
      <main className="main">
        {view.kind === "home" && (
          <Home events={events} onNew={newMeeting} onOpenEvent={openEvent} onRefresh={() => refreshEvents(true)} />
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
          <div className="page">
            <h1 className="page-title">Chiedi a tutti i tuoi meeting</h1>
            <ChatPanel
              scope="global"
              toast={toast}
              suggestions={[
                "Quali azioni sono rimaste aperte questa settimana?",
                "Cosa abbiamo deciso nell'ultimo meeting con il cliente?",
                "Riassumi i temi ricorrenti degli standup",
              ]}
              big
            />
          </div>
        )}
        {view.kind === "settings" && <SettingsView toast={toast} onCalendarChanged={() => refreshEvents(true)} />}
        {view.kind === "templates" && <TemplatesView toast={toast} />}
      </main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn small primary"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-x" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
