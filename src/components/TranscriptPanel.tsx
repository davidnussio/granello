import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "../types";
import { mmss } from "../format";
import { t } from "../i18n";

export default function TranscriptPanel({
  segments,
  live,
  importing = false,
}: {
  segments: TranscriptSegment[];
  live: boolean;
  importing?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [segments.length]);

  // raggruppa segmenti consecutivi della stessa sorgente in "bolle"
  const groups: { source: string; start: number; texts: string[] }[] = [];
  for (const s of segments) {
    const last = groups[groups.length - 1];
    if (last && last.source === s.source && s.startMs - last.start < 90_000) last.texts.push(s.text);
    else groups.push({ source: s.source, start: s.startMs, texts: [s.text] });
  }

  return (
    <div
      className="transcript"
      ref={box}
      onScroll={() => {
        const el = box.current!;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {groups.length === 0 && (
        <p className="muted small pad">
          {live
            ? t("In ascolto… la trascrizione compare dopo le prime pause.")
            : importing
              ? t("Trascrivo il file… il testo compare man mano.")
              : t("Nessuna trascrizione. Premi Registra o carica un file audio.")}
        </p>
      )}
      {groups.map((g, i) => (
        <div key={i} className={"bubble " + g.source}>
          <div className="bubble-meta">
            {g.source === "me" ? t("Tu") : g.source === "file" ? t("Audio") : t("Altri")} · {mmss(g.start)}
          </div>
          {g.texts.join(" ")}
        </div>
      ))}
      {live && <div className="listening">{t("● in ascolto")}</div>}
      <div ref={end} />
    </div>
  );
}
