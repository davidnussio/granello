import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, newStreamId, on } from "../api";
import type { Meeting, RecordingStatus, Template, TranscriptSegment } from "../types";
import NoteEditor from "../editor/NoteEditor";
import Markdown from "./Markdown";
import TranscriptPanel from "./TranscriptPanel";
import ChatPanel from "./ChatPanel";
import { dayLabel, mmss, time } from "../format";

interface Props {
  id: string;
  rec: RecordingStatus;
  toast: (t: string) => void;
  onChanged: () => void;
  onRecChanged: () => void;
  onDeleted: () => void;
}

type Tab = "notes" | "enhanced";
type Side = "none" | "transcript" | "chat";

function useDebounced<T>(fn: (v: T) => void, ms: number) {
  const timer = useRef<number>();
  const last = useRef<{ v: T } | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (last.current) {
      fnRef.current(last.current.v);
      last.current = null;
    }
  }, []);
  const call = useCallback(
    (v: T) => {
      last.current = { v };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, ms);
    },
    [flush, ms],
  );
  useEffect(() => flush, [flush]); // salva all'uscita
  // salva subito anche quando la finestra perde il fuoco o sta per chiudersi,
  // senza aspettare il debounce: chiudendo l'app non si perde l'ultima frase
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);
  return call;
}

export default function MeetingView({ id, rec, toast, onChanged, onRecChanged, onDeleted }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tab, setTab] = useState<Tab>("notes");
  const [side, setSide] = useState<Side>("none");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [level, setLevel] = useState<{ mic: number; system: number | null }>({ mic: 0, system: null });
  const [elapsed, setElapsed] = useState(0);
  const [busyRec, setBusyRec] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [enhVersion, setEnhVersion] = useState(0);
  const streamRef = useRef<string | null>(null);

  const isRecording = rec.meetingId === id;
  const otherRecording = rec.recording && !isRecording;

  const load = useCallback(async () => {
    try {
      const d = await api.getMeeting(id);
      setMeeting(d.meeting);
      setSegments(d.segments);
      if (d.meeting.enhancedMd) setTab("enhanced");
    } catch (e) {
      toast(errorText(e));
    }
  }, [id, toast]);

  useEffect(() => {
    load();
    api.listTemplates().then(setTemplates).catch(() => {});
  }, [load]);

  useEffect(() => {
    const offs = [
      on("transcript-segment", (s) => {
        if (s.meetingId === id) setSegments((prev) => [...prev, s].sort((a, b) => a.startMs - b.startMs));
      }),
      on("audio-level", (l) => {
        if (l.meetingId === id) setLevel({ mic: l.mic, system: l.system });
      }),
      on("recording-finished", (mid) => {
        if (mid === id) setFinishing(false);
      }),
      on("llm-delta", (d) => {
        if (d.streamId === streamRef.current) setStreaming((s) => (s ?? "") + d.delta);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [id]);

  // cronometro
  useEffect(() => {
    if (!isRecording) return;
    const startedAt = Date.now();
    const base = segments.length ? segments[segments.length - 1].endMs : 0;
    const iv = setInterval(() => setElapsed(base + Date.now() - startedAt), 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const saveNotes = useDebounced<string>((notesMd) => {
    api.updateMeeting({ id, notesMd }).catch((e) => toast(errorText(e)));
  }, 600);
  const saveEnhanced = useDebounced<string>((enhancedMd) => {
    api.updateMeeting({ id, enhancedMd }).catch((e) => toast(errorText(e)));
  }, 600);
  const saveTitle = useDebounced<string>((title) => {
    api.updateMeeting({ id, title }).then(onChanged).catch((e) => toast(errorText(e)));
  }, 500);

  const toggleRecording = async () => {
    setBusyRec(true);
    try {
      if (isRecording) {
        setFinishing(true);
        await api.stopRecording();
      } else {
        await api.startRecording(id);
        setSide((s) => (s === "none" ? "transcript" : s));
      }
    } catch (e) {
      setFinishing(false);
      toast(errorText(e));
    } finally {
      setBusyRec(false);
      onRecChanged();
    }
  };

  const enhance = async () => {
    if (!meeting) return;
    const sid = newStreamId();
    streamRef.current = sid;
    setStreaming("");
    setTab("enhanced");
    try {
      const text = await api.enhanceNotes(id, sid);
      setMeeting((m) => (m ? { ...m, enhancedMd: text } : m));
      setEnhVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorText(e));
      // generazione fallita o annullata: senza note AI precedenti si torna alle proprie note
      if (!meeting.enhancedMd) setTab("notes");
    } finally {
      streamRef.current = null;
      setStreaming(null);
    }
  };

  const changeTemplate = async (templateId: string) => {
    setMeeting((m) => (m ? { ...m, templateId } : m));
    await api.updateMeeting({ id, templateId }).catch((e) => toast(errorText(e)));
  };

  const copyEnhanced = async () => {
    const text = meeting?.enhancedMd ?? "";
    await navigator.clipboard.writeText(`# ${meeting?.title}\n\n${text}`);
    toast("Note copiate negli appunti");
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    try {
      await api.deleteMeeting(id);
      onDeleted();
    } catch (e) {
      toast(errorText(e));
    }
  };

  if (!meeting) return <div className="page muted">Caricamento…</div>;

  const hasContent = meeting.notesMd.trim().length > 0 || segments.length > 0;
  const canEnhance = hasContent && !isRecording && streaming === null;
  const when = meeting.startedAt ?? meeting.createdAt;

  return (
    <div className={"meeting" + (side !== "none" ? " with-side" : "")}>
      <div className="meeting-main">
        <header className="meeting-header">
          <input
            className="title-input"
            aria-label="Titolo del meeting"
            defaultValue={meeting.title}
            placeholder="Titolo del meeting"
            onChange={(e) => saveTitle(e.target.value)}
          />
          <div className="meta-row">
            <span className="chip">
              {dayLabel(when)} · {time(when)}
            </span>
            {meeting.attendees.slice(0, 6).map((a) => (
              <span key={a} className="chip person">
                {a}
              </span>
            ))}
            {meeting.attendees.length > 6 && <span className="chip">+{meeting.attendees.length - 6}</span>}
            <select
              className="chip select"
              value={meeting.templateId ?? "generale"}
              onChange={(e) => changeTemplate(e.target.value)}
              title="Template usato per le note AI"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  ☰ {t.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="toolbar">
          <div className="seg">
            <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>
              Le mie note
            </button>
            <button
              className={tab === "enhanced" ? "on" : ""}
              onClick={() => setTab("enhanced")}
              disabled={!meeting.enhancedMd && streaming === null}
            >
              ✦ Note AI
            </button>
          </div>
          <div className="spacer" />
          {tab === "enhanced" && meeting.enhancedMd && streaming === null && (
            <button className="btn small ghost" onClick={copyEnhanced}>
              Copia
            </button>
          )}
          {streaming !== null ? (
            <button
              className="btn small"
              onClick={() => streamRef.current && api.cancelStream(streamRef.current).catch(() => {})}
              title="Interrompe la generazione: le note AI precedenti restano invariate"
            >
              ◼ Interrompi
            </button>
          ) : (
            <button
              className={"btn small" + (canEnhance && !meeting.enhancedMd ? " primary" : "")}
              disabled={!canEnhance}
              onClick={enhance}
              title={isRecording ? "Ferma la registrazione per generare le note" : ""}
            >
              {meeting.enhancedMd ? "↻ Rigenera note AI" : "✦ Genera note AI"}
            </button>
          )}
        </div>

        <div className="doc">
          {tab === "notes" && (
            <NoteEditor
              docKey={id + ":notes"}
              value={meeting.notesMd}
              placeholder="Scrivi i punti importanti, al resto pensa la trascrizione. Digita / per i comandi."
              onChange={(md) => {
                setMeeting((m) => (m ? { ...m, notesMd: md } : m));
                saveNotes(md);
              }}
            />
          )}
          {tab === "enhanced" &&
            (streaming !== null ? (
              <div className="streaming">
                <Markdown text={streaming || "…"} />
              </div>
            ) : (
              <NoteEditor
                docKey={id + ":enhanced:" + enhVersion}
                value={meeting.enhancedMd ?? ""}
                className="enhanced"
                onChange={(md) => saveEnhanced(md)}
              />
            ))}
        </div>

        <footer className="recbar">
          <button
            className={"rec-btn" + (isRecording ? " on" : "")}
            onClick={toggleRecording}
            disabled={busyRec || otherRecording}
            title={otherRecording ? "C'è già una registrazione in corso su un altro meeting" : ""}
          >
            <span className="rec-icon" />
            {isRecording ? "Stop" : segments.length ? "Riprendi" : "Registra"}
          </button>
          {isRecording && (
            <>
              <Meter label="Tu" value={level.mic} />
              {level.system !== null && <Meter label="Altri" value={level.system} />}
              <span className="muted small mono">{mmss(elapsed)}</span>
            </>
          )}
          {(finishing || (isRecording && rec.pendingChunks > 1)) && (
            <span className="muted small">Completo la trascrizione…</span>
          )}
          {!isRecording && otherRecording && <span className="muted small">Registrazione in corso altrove</span>}
          <div className="spacer" />
          <button className={"btn small ghost" + (side === "transcript" ? " on" : "")} onClick={() => setSide(side === "transcript" ? "none" : "transcript")}>
            Trascrizione {segments.length ? `(${segments.length})` : ""}
          </button>
          <button className={"btn small ghost" + (side === "chat" ? " on" : "")} onClick={() => setSide(side === "chat" ? "none" : "chat")}>
            ✦ Chiedi
          </button>
          <button className={"btn small ghost danger"} onClick={remove} disabled={isRecording}>
            {confirmDelete ? "Confermi?" : "Elimina"}
          </button>
        </footer>
      </div>

      {side !== "none" && (
        <aside className="side-panel">
          <div className="side-panel-head">
            <strong>{side === "transcript" ? "Trascrizione" : "Chiedi su questo meeting"}</strong>
            <button className="toast-x" aria-label="Chiudi pannello" onClick={() => setSide("none")}>
              ×
            </button>
          </div>
          {side === "transcript" ? (
            <TranscriptPanel segments={segments} live={isRecording} />
          ) : (
            <ChatPanel
              scope={id}
              toast={toast}
              suggestions={["Scrivi una email di follow-up", "Quali sono le azioni e chi le fa?", "Cosa non è stato deciso?"]}
            />
          )}
        </aside>
      )}
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  // RMS -> scala percettiva grezza
  const pct = Math.min(100, Math.round(Math.sqrt(value) * 220));
  return (
    <span className="meter" title={label}>
      <span className="meter-label">{label}</span>
      <span className="meter-track">
        <span className="meter-fill" style={{ width: pct + "%" }} />
      </span>
    </span>
  );
}
