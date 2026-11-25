import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Privacy, TranscriptPart, TranscriptSegment } from "../types";
import { mmss } from "../format";
import { t } from "../i18n";
import PrivacyIcon, { privacyHint, privacyLabel } from "./PrivacyIcon";

type Source = TranscriptSegment["source"];

/** Le sorgenti dell'audio locale; ogni altra sorgente è il nome di un parlante. */
const BUILT_IN = ["me", "them", "file"];
const isSpeaker = (source: Source) => !BUILT_IN.includes(source);
const label = (source: Source) =>
  source === "me" ? t("Tu") : source === "file" ? t("Audio") : source === "them" ? t("Altri") : source;

/** Il testo selezionato nella trascrizione e cosa se ne può fare. */
interface Picked {
  /** I segmenti toccati, con i caratteri selezionati dove la selezione non li prende interi. */
  parts: TranscriptPart[];
  /** Presente se la selezione sta in una sola bolla: solo così ha un autore, e si può citare. */
  quote: { ms: number; source: Source; text: string } | null;
  /** Dove sta la selezione dentro l'elenco che scorre: bordo alto, bordo basso, centro. */
  top: number;
  bottom: number;
  center: number;
}

/** Posizione in caratteri (non in unità UTF-16, che per le emoji sono due): è così che conta il backend. */
const chars = (text: string, offset: number) => Array.from(text.slice(0, offset)).length;

export default function TranscriptPanel({
  segments,
  live,
  importing = false,
  focus = null,
  onQuote,
  onRedact,
  onReview,
  onRename,
  kept = null,
  privacy,
  people = [],
  onAssign,
}: {
  segments: TranscriptSegment[];
  live: boolean;
  importing?: boolean;
  /** Punto da mostrare (ms): cambia oggetto a ogni richiesta, anche per lo stesso punto. */
  focus?: { ms: number } | null;
  /** Il testo selezionato in una bolla diventa una citazione nelle note. */
  onQuote?: (quote: { ms: number; source: Source; text: string }) => void;
  /** Oscura per sempre le parti indicate. */
  onRedact?: (parts: TranscriptPart[]) => void;
  /** Segna i segmenti come "da verificare" (true) o li libera (false). */
  onReview?: (ids: number[], review: boolean) => void;
  /** Dà un nome a un parlante riconosciuto dall'affinamento online. */
  onRename?: (from: string, to: string) => void;
  /** Audio conservato in attesa dell'affinamento online, e cosa farne. */
  kept?: { refining: boolean; refine: () => void; discard: () => void } | null;
  /** Livello di privacy del meeting: chi registra lo vede in cima alla trascrizione. */
  privacy?: Privacy;
  /** I partecipanti, tra cui scegliere chi ha detto una frase. */
  people?: string[];
  /** Attribuisce i segmenti a un parlante ("me" = tu). */
  onAssign?: (ids: number[], name: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [confirm, setConfirm] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  /** Dove sta la barra della selezione, calcolato dopo averla misurata. */
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [segments.length]);

  // raggruppa segmenti consecutivi della stessa sorgente in "bolle"
  const groups: { source: Source; start: number; parts: TranscriptSegment[] }[] = [];
  for (const s of segments) {
    const last = groups[groups.length - 1];
    if (last && last.source === s.source && s.startMs - last.start < 90_000) last.parts.push(s);
    else groups.push({ source: s.source, start: s.startMs, parts: [s] });
  }
  const pending = segments.filter((s) => s.review);

  // Legge la selezione: quali segmenti tocca e in quali caratteri. Il minuto di una
  // citazione è quello del segmento in cui la selezione comincia.
  const readSelection = () => {
    const sel = window.getSelection();
    const el = box.current;
    setConfirm(false);
    // scrivendo un nome nel campo "Chi parla" la selezione nel testo sparisce: va tenuta
    if (document.activeElement?.closest(".pick-actions")) return;
    setAsking(false);
    if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0) return setPicked(null);
    const range = sel.getRangeAt(0);
    const parts: TranscriptPart[] = [];
    const bubbles = new Set<HTMLElement>();
    let first: HTMLElement | null = null;
    for (const span of el.querySelectorAll<HTMLElement>("[data-seg]")) {
      const node = span.firstChild;
      if (!node || !range.intersectsNode(span)) continue;
      const text = node.textContent ?? "";
      const from = range.startContainer === node ? range.startOffset : 0;
      const to = range.endContainer === node ? range.endOffset : text.length;
      if (from >= to) continue;
      first ??= span;
      bubbles.add(span.closest<HTMLElement>(".bubble")!);
      const whole = from === 0 && to === text.length;
      parts.push(
        whole
          ? { id: Number(span.dataset.seg) }
          : { id: Number(span.dataset.seg), start: chars(text, from), end: chars(text, to) },
      );
    }
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!parts.length || !first || !text) return setPicked(null);
    const bubble = [...bubbles][0];
    const rect = range.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    setPicked({
      parts,
      quote:
        bubbles.size === 1
          ? { ms: Number(first.dataset.ms ?? 0), source: bubble.dataset.source as Source, text }
          : null,
      top: rect.top - host.top + el.scrollTop,
      bottom: rect.bottom - host.top + el.scrollTop,
      center: rect.left + rect.width / 2 - host.left,
    });
  };
  useEffect(() => {
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La barra sta sotto la selezione, centrata su di essa e sempre dentro il pannello; se sotto
  // non c'è spazio visibile (ultime righe della trascrizione) va sopra.
  useLayoutEffect(() => {
    const el = box.current;
    const b = bar.current;
    if (!picked || !el || !b) return setPlace(null);
    const gap = 6;
    const height = b.offsetHeight;
    const viewTop = el.scrollTop;
    const viewBottom = el.scrollTop + el.clientHeight;
    const below = picked.bottom + gap;
    const above = picked.top - height - gap;
    const top =
      below + height <= viewBottom - gap
        ? below
        : above >= viewTop + gap
          ? above
          : // la selezione è più alta del pannello: in basso, sopra il testo
            viewBottom - height - gap;
    const left = Math.max(8, Math.min(picked.center - b.offsetWidth / 2, el.clientWidth - b.offsetWidth - 8));
    setPlace({ top, left });
  }, [picked, asking, confirm]);

  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
    setConfirm(false);
    setAsking(false);
  };

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
      {privacy && (
        <div className={"privacy-line " + privacy} title={privacyHint(privacy)}>
          <PrivacyIcon privacy={privacy} />
          <span>{privacyLabel(privacy)}</span>
        </div>
      )}
      {pending.length > 0 && (
        <div className="review-banner" role="status">
          <strong>
            {pending.length === 1
              ? t("1 parte da verificare")
              : t("{n} parti da verificare", { n: pending.length })}
          </strong>
          <span>
            {t(
              "Finché ce ne sono, questa nota non viene inviata a modelli online. Per ognuna scegli Oscura oppure Va bene.",
            )}
          </span>
        </div>
      )}
      {kept && (
        <div className="review-banner kept-audio" role="status">
          <strong>
            {kept.refining
              ? t("Affino la trascrizione online…")
              : t("Audio conservato per l'affinamento online")}
          </strong>
          <span>
            {kept.refining
              ? t(
                  "L'audio è in elaborazione su Gladia: quando torna, la trascrizione avrà i parlanti e l'audio verrà cancellato.",
                )
              : t(
                  "Caricandolo su Gladia ottieni una trascrizione con i parlanti. In ogni caso l'audio non resta: viene cancellato dopo il caricamento, o subito se lo elimini.",
                )}
          </span>
          {!kept.refining && (
            <span className="row gap">
              <button className="btn small primary" onClick={kept.refine}>
                {t("Affina online")}
              </button>
              <button className="btn small" onClick={kept.discard}>
                {t("Elimina l'audio")}
              </button>
            </span>
          )}
        </div>
      )}
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
          className={
            "bubble " + (isSpeaker(g.source) ? "speaker" : g.source) + (i === focused ? " focused" : "")
          }
          data-source={g.source}
        >
          <div className="bubble-meta">
            {renaming === g.source + i ? (
              <input
                className="speaker-input"
                autoFocus
                defaultValue={g.source}
                aria-label={t("Nome del parlante")}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== g.source) onRename?.(g.source, name);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : isSpeaker(g.source) && onRename ? (
              <button
                className="speaker-name"
                title={t("Dai un nome a questo parlante: vale per tutta la trascrizione")}
                onClick={() => setRenaming(g.source + i)}
              >
                {g.source}
              </button>
            ) : (
              label(g.source)
            )}{" "}
            · {mmss(g.start)}
          </div>
          {g.parts.map((s, j) => (
            <span key={s.id}>
              {j > 0 && " "}
              {/* dentro c'è solo il testo: le posizioni dei caratteri selezionati si contano da qui */}
              <span data-seg={s.id} data-ms={s.startMs} className={s.review ? "tseg review" : "tseg"}>
                {s.text}
              </span>
              {s.review && (
                <span className="tseg-actions">
                  <button
                    onClick={() => onRedact?.([{ id: s.id }])}
                    title={t("Oscura questa parte per sempre")}
                  >
                    {t("Oscura")}
                  </button>
                  <button
                    onClick={() => onReview?.([s.id], false)}
                    title={t("Va bene così: non è più da verificare")}
                  >
                    {t("Va bene")}
                  </button>
                </span>
              )}
            </span>
          ))}
        </div>
      ))}
      {picked && (
        <div
          className="pick-actions"
          ref={bar}
          // finché non è misurata resta invisibile, così non la si vede saltare
          style={place ? place : { top: picked.bottom, left: 8, visibility: "hidden" }}
          // il click non deve togliere la selezione prima di averla letta
          onMouseDown={(e) => e.preventDefault()}
        >
          {picked.quote && onQuote && !asking && (
            <button
              className="btn small primary"
              title={t("Cita nelle note: la frase, chi l'ha detta e il minuto")}
              onClick={() => {
                onQuote(picked.quote!);
                done();
              }}
            >
              {t("❝ Cita")}
            </button>
          )}
          {onAssign && !asking && (
            <button
              className="btn small"
              title={t("Indica chi ha detto il testo selezionato")}
              onClick={() => setAsking(true)}
            >
              {t("Chi parla…")}
            </button>
          )}
          {onAssign && asking && (
            <span className="who-menu">
              {["me", ...people].map((name) => (
                <button
                  key={name}
                  className="btn small"
                  onClick={() => {
                    onAssign(
                      picked.parts.map((p) => p.id),
                      name,
                    );
                    done();
                  }}
                >
                  {name === "me" ? t("Io") : name}
                </button>
              ))}
              <input
                className="speaker-input"
                placeholder={t("Altro nome…")}
                aria-label={t("Nome del parlante")}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  const name = e.currentTarget.value.trim();
                  if (e.key === "Enter" && name) {
                    onAssign(
                      picked.parts.map((p) => p.id),
                      name,
                    );
                    done();
                  } else if (e.key === "Escape") setAsking(false);
                }}
              />
            </span>
          )}
          {onReview && !asking && (
            <button
              className="btn small"
              title={t("Resta leggibile, ma la nota non va a modelli online finché non decidi")}
              onClick={() => {
                onReview(
                  picked.parts.map((p) => p.id),
                  true,
                );
                done();
              }}
            >
              {t("Da verificare")}
            </button>
          )}
          {onRedact && !asking && (
            <button
              className={"btn small" + (confirm ? " danger" : "")}
              title={t("Cancella per sempre il testo selezionato: non si può annullare")}
              onClick={() => {
                if (!confirm) return setConfirm(true);
                onRedact(picked.parts);
                done();
              }}
            >
              {confirm ? t("Oscurare per sempre?") : t("Oscura")}
            </button>
          )}
        </div>
      )}
      {live && <div className="listening">{t("● in ascolto")}</div>}
      <div ref={end} />
    </div>
  );
}
