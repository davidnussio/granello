import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "../types";
import { mmss } from "../format";
import { t } from "../i18n";

export default function TranscriptPanel({
  segments,
  live,
  importing = false,
  focus = null,
}: {
  segments: TranscriptSegment[];
  live: boolean;
  importing?: boolean;
  /** Punto da mostrare (ms): cambia oggetto a ogni richiesta, anche per lo stesso punto. */
  focus?: { ms: number } | null;
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

  // la bolla che contiene il punto richiesto: l'ultima iniziata prima
  let focused = -1;
  if (focus) groups.forEach((g, i) => g.start <= focus.ms && (focused = i));
  if (focus && focused < 0 && groups.length) focused = 0;
  const focusedEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus || !focusedEl.current) return;
    stick.current = false;
    focusedEl.current.scrollIntoView({ block: "center" });
  }, [focus]);

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
        <div key={i} ref={i === focused ? focusedEl : undefined} className={"bubble " + g.source + (i === focused ? " focused" : "")}>
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
