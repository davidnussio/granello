import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { LibraryFile } from "../types";
import { dayLabel, sizeLabel } from "../format";
import { t } from "../i18n";
import Recordings from "./Recordings";

type Kind = "recordings" | "images" | "other";

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic)$/i;
const isImage = (f: LibraryFile) => IMAGE.test(f.path);

/** Il glifo di un file che non è un'immagine, dalla sua estensione. */
function glyph(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "▤";
  if (["mp3", "m4a", "wav", "aac", "ogg", "flac", "aiff", "caf"].includes(ext)) return "♪";
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "▶";
  if (["zip", "gz", "tar", "7z", "rar"].includes(ext)) return "▦";
  return "▢";
}

/** L'anteprima di un'immagine: il file si legge solo quando la riga entra in vista. */
function Thumb({ file }: { file: LibraryFile }) {
  const root = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || file.missing) return;
    let alive = true;
    const load = () =>
      api
        .readAttachment(file.path)
        .then((url) => alive && setSrc(url))
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
  }, [file.path, file.missing]);
  return (
    <span ref={root} className="file-thumb" aria-hidden="true">
      {src ? <img src={src} alt="" /> : "▣"}
    </span>
  );
}

/**
 * I file del vault aperto, nella Libreria: le registrazioni (con il loro player), le immagini e
 * gli altri file. Un allegato porta alla sua nota; un file senza nota (arrivato da un import)
 * dice da quale cartella veniva e si può eliminare.
 */
export default function Files({
  onOpen,
  toast,
  onCount,
}: {
  onOpen: (meetingId: string) => void;
  toast: (text: string) => void;
  /** Quanti file ci sono in tutto, registrazioni comprese. */
  onCount?: (n: number) => void;
}) {
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [recordings, setRecordings] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([api.listFiles(), api.listRecordings()])
        .then(([list, recs]) => {
          setFiles(list);
          setRecordings(recs.length);
        })
        .catch((e) => toast(errorText(e))),
    [toast],
  );
  useEffect(() => void load(), [load]);

  const images = useMemo(() => (files ?? []).filter(isImage), [files]);
  const other = useMemo(() => (files ?? []).filter((f) => !isImage(f)), [files]);
  const counts: Record<Kind, number> = {
    recordings: recordings ?? 0,
    images: images.length,
    other: other.length,
  };
  const total = counts.recordings + counts.images + counts.other;
  useEffect(() => {
    if (files && recordings !== null) onCount?.(total);
  }, [files, recordings, total, onCount]);

  if (!files || recordings === null) return null;
  // si parte dalla prima scheda che ha qualcosa
  const shown: Kind =
    kind ?? (["recordings", "images", "other"] as const).find((k) => counts[k] > 0) ?? "recordings";
  const list = shown === "images" ? images : other;

  const remove = async (f: LibraryFile) => {
    if (confirm !== f.id) {
      setConfirm(f.id);
      return;
    }
    setConfirm(null);
    try {
      await api.deleteFile(f.id);
      await load();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const open = (f: LibraryFile) => api.openAttachment(f.path).catch((e) => toast(errorText(e)));

  const tabs: { id: Kind; label: string }[] = [
    { id: "recordings", label: t("Registrazioni") },
    { id: "images", label: t("Immagini") },
    { id: "other", label: t("Altri file") },
  ];

  return (
    <div className="files">
      <div className="seg files-kinds" role="group" aria-label={t("Tipi di file")}>
        {tabs.map((k) => (
          <button
            key={k.id}
            className={shown === k.id ? "on" : ""}
            aria-pressed={shown === k.id}
            onClick={() => setKind(k.id)}
          >
            {k.label} <span className="files-count">{counts[k.id]}</span>
          </button>
        ))}
      </div>

      {shown === "recordings" ? (
        <Recordings onOpen={onOpen} toast={toast} />
      ) : list.length === 0 ? (
        <p className="muted small rec-empty">
          {shown === "images"
            ? t("Nessuna immagine. Le immagini incollate o trascinate in una nota compaiono qui.")
            : t(
                "Nessun file. Gli allegati delle note e i file importati senza una nota (Impostazioni → Importa da) compaiono qui.",
              )}
        </p>
      ) : (
        <ul className="files-list">
          {list.map((f) => (
            <li key={f.id} className={"file-row" + (f.missing ? " missing" : "")}>
              {shown === "images" ? (
                <Thumb file={f} />
              ) : (
                <span className="file-thumb" aria-hidden="true">
                  {glyph(f.name)}
                </span>
              )}
              <div className="file-main">
                <button
                  className="file-name"
                  disabled={f.missing}
                  onClick={() => void open(f)}
                  title={t("Apri con l'app predefinita")}
                >
                  {f.name}
                </button>
                <span className="muted small file-meta">
                  {f.missing ? t("File non trovato") : sizeLabel(f.bytes)} · {dayLabel(f.at)}
                  {" · "}
                  {f.meetingId ? (
                    <button
                      className="file-note"
                      onClick={() => onOpen(f.meetingId!)}
                      title={t("Apri la nota")}
                    >
                      {f.meetingTitle || t("Senza titolo")}
                    </button>
                  ) : (
                    <span title={t("Importato senza una nota")}>
                      {f.folder ? t("Senza nota · {folder}", { folder: f.folder }) : t("Senza nota")}
                    </span>
                  )}
                </span>
              </div>
              {!f.meetingId && (
                <button
                  className={"btn small ghost" + (confirm === f.id ? " danger" : "")}
                  onClick={() => void remove(f)}
                >
                  {confirm === f.id ? t("Confermi?") : t("Elimina")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
