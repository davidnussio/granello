import { useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "../types";
import { mmss } from "../format";
import { t } from "../i18n";

export default function TranscriptPanel({
  segments,
  live,
  importing = false,
  focus = null,
  onQuote,
}: {
  segments: TranscriptSegment[];
  live: boolean;
  importing?: boolean;
  /** Punto da mostrare (ms): cambia oggetto a ogni richiesta, anche per lo stesso punto. */
  focus?: { ms: number } | null;
  /** Il testo selezionato in una bolla diventa una citazione nelle note. */
  onQuote?: (quote: { ms: number; source: TranscriptSegment["source"]; text: string }) => void;
}) {
  const [picked, setPicked] = useState<{ ms: number; source: TranscriptSegment["source"]; text: string; top: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [segments.length]);

  // raggruppa segmenti consecutivi della stessa sorgente in "bolle"
  const groups: { source: TranscriptSegment["source"]; start: number; parts: TranscriptSegment[] }[] = [];
  for (const s of segments) {
    const last = groups[groups.length - 1];
    if (last && last.source === s.source && s.startMs - last.start < 90_000) last.parts.push(s);
    else groups.push({ source: s.source, start: s.startMs, parts: [s] });
  }

  // Testo selezionato dentro una sola bolla: si può citare. Il minuto è quello del segmento
  // in cui comincia la selezione.
  const readSelection = () => {
    const sel = window.getSelection();
    const el = box.current;
    if (!onQuote || !el || !sel || sel.isCollapsed || sel.rangeCount === 0) return setPicked(null);
    const range = sel.getRangeAt(0);
    const within = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>(".bubble") ?? null;
    const bubble = within(range.startContainer);
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!bubble || !el.contains(bubble) || within(range.endContainer) !== bubble || !text) return setPicked(null);
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const part = start?.closest<HTMLElement>("[data-ms]") ?? bubble.querySelector<HTMLElement>("[data-ms]");
    const rect = range.getBoundingClientRect();
    setPicked({
      ms: Number(part?.dataset.ms ?? bubble.dataset.ms ?? 0),
      source: bubble.dataset.source as TranscriptSegment["source"],
      text,
      top: rect.bottom - el.getBoundingClientRect().top + el.scrollTop + 4,
    });
  };
  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onQuote]);

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
        <div
          key={i}
          ref={i === focused ? focusedEl : undefined}
          className={"bubble " + g.source + (i === focused ? " focused" : "")}
          data-source={g.source}
          data-ms={g.start}
        >
          <div className="bubble-meta">
            {g.source === "me" ? t("Tu") : g.source === "file" ? t("Audio") : t("Altri")} · {mmss(g.start)}
          </div>
          {g.parts.map((s, j) => (
            <span key={s.id} data-ms={s.startMs}>
              {(j ? " " : "") + s.text}
            </span>
          ))}
        </div>
      ))}
      {picked && onQuote && (
        <button
          className="btn small primary quote-pick"
          style={{ top: picked.top }}
          // il click non deve togliere la selezione prima di averla letta
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onQuote({ ms: picked.ms, source: picked.source, text: picked.text });
            window.getSelection()?.removeAllRanges();
            setPicked(null);
          }}
        >
          {t("❝ Cita nelle note")}
        </button>
      )}
      {live && <div className="listening">{t("● in ascolto")}</div>}
      <div ref={end} />
    </div>
  );
}
