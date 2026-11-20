import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api, errorText } from "../api";
import type { Recording } from "../types";
import { dayLabel, mmss, time } from "../format";
import { t } from "../i18n";

const megabytes = (bytes: number) =>
  (bytes / 1_048_576).toLocaleString(undefined, { maximumFractionDigits: bytes < 10_485_760 ? 1 : 0 });

/**
 * Le registrazioni salvate, ognuna con il suo player. Senza `meetingId` è l'elenco di tutte
 * (nella Libreria), con il link al meeting; con `meetingId` solo quelle di quel meeting.
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
  const [canTrim, setCanTrim] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

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
      .then((info) => setCanTrim(info.ffmpeg))
      .catch(() => {});
  }, []);

  const remove = async (r: Recording) => {
    if (confirm !== r.id) {
      setConfirm(r.id);
      setTimeout(() => setConfirm((c) => (c === r.id ? null : c)), 4000);
      return;
    }
    try {
      await api.deleteRecording(r.id);
      setConfirm(null);
      load();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const trim = async (r: Recording) => {
    setBusy(r.id);
    try {
      await api.trimRecording(r.id);
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
          'Nessuna registrazione salvata. Attiva "Salva le registrazioni" nelle Impostazioni: da lì in poi l\'audio di ogni riunione resta qui.',
        )}
      </p>
    );
  }

  return (
    <div className={"recordings" + (meetingId ? " compact" : "")}>
      {list.map((r) => (
        <div key={r.id} className="recording">
          <div className="recording-head">
            {!meetingId && (
              <button
                className="recording-title"
                onClick={() => onOpen?.(r.meetingId)}
                title={t("Apri il meeting")}
              >
                {r.meetingTitle || t("Senza titolo")}
              </button>
            )}
            <span className="muted small">
              {dayLabel(r.startedAt)} · {time(r.startedAt)}
              {r.durationMs > 0 && ` · ${mmss(r.durationMs)}`}
              {r.bytes > 0 && ` · ${megabytes(r.bytes)} MB`}
              {r.trimmed && ` · ${t("senza pause")}`}
            </span>
          </div>
          {r.durationMs === 0 ? (
            <p className="muted small">{t("Registrazione in corso, o non ancora chiusa.")}</p>
          ) : (
            // preload "none": finché non si preme play non si legge nessun file
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- le registrazioni dei meeting non hanno sottotitoli
            <audio controls preload="none" src={convertFileSrc(r.path)} />
          )}
          <div className="recording-actions">
            {!r.trimmed && r.durationMs > 0 && canTrim && (
              <button
                className="btn small ghost"
                disabled={busy === r.id}
                onClick={() => trim(r)}
                title={t(
                  "Toglie le pause senza audio. Dopo, i minuti non corrispondono più a quelli della trascrizione.",
                )}
              >
                {busy === r.id ? t("Tolgo le pause…") : t("Togli le pause")}
              </button>
            )}
            <button
              className={"btn small ghost" + (confirm === r.id ? " danger" : "")}
              onClick={() => remove(r)}
            >
              {confirm === r.id ? t("Confermi?") : t("Elimina")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
