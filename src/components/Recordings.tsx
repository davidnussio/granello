import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, errorText } from "../api";
import type { Recording } from "../types";
import { dayLabel, mmss, time } from "../format";
import { t } from "../i18n";

const megabytes = (bytes: number) =>
  (bytes / 1_048_576).toLocaleString(undefined, { maximumFractionDigits: bytes < 10_485_760 ? 1 : 0 });

/** Barre mostrate finché la forma d'onda non è arrivata (o se il file non si legge). */
const FLAT = Array.from<number>({ length: 160 }).fill(0);

/**
 * Il player di una registrazione: play, la forma d'onda che fa anche da barra del tempo, e
 * il minuto. Finché non si preme play (o non si sposta il punto) il file audio non viene letto.
 */
function Player({ recording, toast }: { recording: Recording; toast: (text: string) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [bars, setBars] = useState<number[] | null>(null);
  /** Un punto scelto prima che l'audio fosse caricato: si applica appena lo è. */
  const pendingSeek = useRef<number | null>(null);
  const duration = recording.durationMs / 1000;

  // la forma d'onda si chiede solo quando la riga entra in vista: calcolarla legge tutto il file
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let alive = true;
    const load = () =>
      api
        .recordingWaveform(recording.id)
        .then((list) => {
          if (alive && list.length) setBars(list);
        })
        .catch(() => {});
    if (typeof IntersectionObserver === "undefined") {
      load();
      return;
    }
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      load();
    });
    seen.observe(el);
    return () => {
      alive = false;
      seen.disconnect();
    };
    // la dimensione cambia quando il file cambia (pause tolte): la forma d'onda va riletta
  }, [recording.id, recording.bytes]);

  const seek = (seconds: number) => {
    const el = audio.current;
    if (!el) return;
    const to = Math.max(0, Math.min(duration, seconds));
    setCurrent(to);
    if (el.readyState >= 1) el.currentTime = to;
    else {
      pendingSeek.current = to;
      el.load();
    }
  };

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) return el.pause();
    // una registrazione alla volta
    for (const other of document.querySelectorAll("audio")) if (other !== el) other.pause();
    el.play().catch(() => {});
  };

  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - box.left) / box.width) * duration);
  };

  const shown = bars ?? FLAT;
  const played = duration > 0 ? current / duration : 0;

  return (
    <div className="rec-player" ref={root}>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- le registrazioni dei meeting non hanno sottotitoli */}
      <audio
        ref={audio}
        preload="none"
        src={convertFileSrc(recording.path)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (pendingSeek.current !== null) e.currentTarget.currentTime = pendingSeek.current;
          pendingSeek.current = null;
        }}
        onError={() => {
          setPlaying(false);
          toast(t("Il file della registrazione non si trova: è stato spostato, o il disco è scollegato."));
        }}
      />
      <button
        className="rec-play"
        onClick={toggle}
        aria-label={playing ? t("Pausa") : t("Riproduci")}
        title={playing ? t("Pausa") : t("Riproduci")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={playing ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5l11 7-11 7z"} fill="currentColor" />
        </svg>
      </button>
      <div
        className={"rec-wave" + (bars ? "" : " flat")}
        role="slider"
        tabIndex={0}
        aria-label={t("Posizione nella registrazione")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={mmss(current * 1000)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e);
        }}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
          if (step) seek(current + step);
          else if (e.key === "Home") seek(0);
          else if (e.key === "End") seek(duration);
          else if (e.key === " " || e.key === "Enter") toggle();
          else return;
          e.preventDefault();
        }}
      >
        <svg viewBox={`0 0 ${shown.length} 100`} preserveAspectRatio="none" aria-hidden="true">
          {shown.map((level, i) => {
            // sempre un filo visibile, anche nel silenzio
            const height = Math.max(4, (level / 255) * 96);
            return (
              <rect
                // oxlint-disable-next-line react/no-array-index-key -- le barre sono posizioni fisse, non voci che si spostano
                key={i}
                className={(i + 0.5) / shown.length <= played ? "on" : ""}
                x={i + 0.2}
                y={50 - height / 2}
                width={0.6}
                height={height}
              />
            );
          })}
        </svg>
      </div>
      <span className="rec-time">
        {mmss(current * 1000)} / {mmss(recording.durationMs)}
      </span>
    </div>
  );
}

/**
 * Le registrazioni salvate, una card per meeting con dentro i suoi audio. Senza `meetingId`
 * è l'elenco di tutte (nella Libreria), con il link al meeting; con `meetingId` solo quelle
 * di quel meeting.
 */
export default function Recordings({
  meetingId,
  version = 0,
  onOpen,
  toast,
}: {
  meetingId?: string;
  /** Cambia quando l'elenco va riletto (es. è appena finita una registrazione). */
  version?: number;
  onOpen?: (meetingId: string) => void;
  toast: (text: string) => void;
}) {
  const [list, setList] = useState<Recording[] | null>(null);
  const [hasFfmpeg, setHasFfmpeg] = useState(false);
  const [busy, setBusy] = useState<number | string | null>(null);
  const [confirm, setConfirm] = useState<number | string | null>(null);

  const load = useCallback(() => {
    api
      .listRecordings(meetingId)
      .then(setList)
      .catch((e) => toast(errorText(e)));
  }, [meetingId, toast]);
  useEffect(load, [load, version]);
  useEffect(() => {
    api
      .recordingsInfo()
      .then((info) => setHasFfmpeg(info.ffmpeg))
      .catch(() => {});
  }, []);

  /** Le registrazioni raggruppate per meeting, nell'ordine in cui arrivano (dalla più recente). */
  const groups = useMemo(() => {
    const byMeeting = new Map<string, Recording[]>();
    for (const r of list ?? []) byMeeting.set(r.meetingId, [...(byMeeting.get(r.meetingId) ?? []), r]);
    return [...byMeeting.values()];
  }, [list]);

  /** Il primo clic chiede conferma, il secondo (entro qualche secondo) procede. */
  const confirmed = (key: number | string) => {
    if (confirm === key) {
      setConfirm(null);
      return true;
    }
    setConfirm(key);
    setTimeout(() => setConfirm((c) => (c === key ? null : c)), 4000);
    return false;
  };

  const run = async (key: number | string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      load();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (!list) return null;
  if (list.length === 0) {
    // dentro un meeting senza registrazioni non c'è niente da dire
    return meetingId ? null : (
      <p className="muted small rec-empty">
        {t(
          'Nessuna registrazione salvata. Attiva "Salva le registrazioni" nelle Impostazioni: da lì in poi l\'audio di ogni registrazione resta qui.',
        )}
      </p>
    );
  }

  return (
    <div className={"recordings" + (meetingId ? " compact" : "")}>
      {groups.map((group) => {
        const meeting = group[0].meetingId;
        const closed = group.filter((r) => r.durationMs > 0);
        const total = closed.reduce((ms, r) => ms + r.durationMs, 0);
        const canMerge = hasFfmpeg && closed.length > 1;
        return (
          <section key={meeting} className="rec-card">
            {(!meetingId || canMerge) && (
              <header className="rec-card-head">
                {!meetingId && (
                  <button
                    className="recording-title"
                    onClick={() => onOpen?.(meeting)}
                    title={t("Apri la nota")}
                  >
                    {group[0].meetingTitle || t("Senza titolo")}
                  </button>
                )}
                <span className="muted small rec-card-sum">
                  {group.length === 1 ? t("1 registrazione") : t("{n} registrazioni", { n: group.length })}
                  {total > 0 && ` · ${mmss(total)}`}
                </span>
                {canMerge && (
                  <button
                    className={"btn small" + (confirm === meeting ? " danger" : "")}
                    disabled={busy !== null}
                    onClick={() => confirmed(meeting) && run(meeting, () => api.mergeRecordings(meeting))}
                    title={t(
                      "Unisce le registrazioni di questa nota in un solo file, dalla più vecchia. I file separati non restano.",
                    )}
                  >
                    {busy === meeting
                      ? t("Unisco…")
                      : confirm === meeting
                        ? t("Unire in un solo file?")
                        : t("Unisci")}
                  </button>
                )}
              </header>
            )}
            {group.map((r) => (
              <div key={r.id} className="rec-row">
                {r.durationMs === 0 ? (
                  <p className="muted small">{t("Registrazione in corso, o non ancora chiusa.")}</p>
                ) : (
                  <Player recording={r} toast={toast} />
                )}
                <div className="rec-row-foot">
                  <span className="muted small">
                    {dayLabel(r.startedAt)} · {time(r.startedAt)}
                    {r.bytes > 0 && ` · ${megabytes(r.bytes)} MB`}
                    {r.trimmed && ` · ${t("senza pause")}`}
                  </span>
                  <span className="rec-row-actions">
                    {!r.trimmed && r.durationMs > 0 && hasFfmpeg && (
                      <button
                        className="btn small ghost"
                        disabled={busy !== null}
                        onClick={() => run(r.id, () => api.trimRecording(r.id))}
                        title={t(
                          "Toglie le pause senza audio. Dopo, i minuti non corrispondono più a quelli della trascrizione.",
                        )}
                      >
                        {busy === r.id ? t("Tolgo le pause…") : t("Togli le pause")}
                      </button>
                    )}
                    <button
                      className={"btn small ghost" + (confirm === r.id ? " danger" : "")}
                      disabled={busy !== null}
                      onClick={() => confirmed(r.id) && run(r.id, () => api.deleteRecording(r.id))}
                    >
                      {confirm === r.id ? t("Confermi?") : t("Elimina")}
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
