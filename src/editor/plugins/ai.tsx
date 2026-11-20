import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { dataBlock, type BlockView } from "../dataBlock";
import { field, h } from "../dom";
import { askAi, onTranscript, transcriptState } from "../aiContext";
import { createDictation, micButton, micContent, micTitle, type DictationPhase } from "../dictation";
import { errorText, notify } from "../../api";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";
import { sparklesEl } from "../../sparkles";

interface LiveAi {
  /** Cosa si chiede, es. "riassumi le obiezioni del cliente". */
  request: string;
  /** L'ultima risposta, in Markdown. */
  result: string;
}

/** Mentre si registra la risposta si ricalcola al massimo ogni due minuti: ogni volta rilegge tutta la trascrizione. */
const LIVE_EVERY_MS = 120_000;
/** A registrazione ferma si aspetta che arrivino gli ultimi segmenti. */
const SETTLE_MS = 4_000;

/** Stato che non si salva: richiesta in corso e a che punto della trascrizione è la risposta. */
interface Running {
  busy: boolean;
  error: string;
  /** Segmenti di trascrizione su cui è basata la risposta attuale. */
  seen: number;
  at: number;
  timer: number | null;
}

/** Una riga fatta solo di due punti chiuderebbe il blocco nel Markdown della nota. */
const safe = (md: string) => md.trim().replace(/^:{3,}\s*$/gm, "");

async function run(view: BlockView<LiveAi>) {
  const state = view.local.ai as Running;
  const request = view.data.request.trim();
  if (!request || state.busy) return;
  state.busy = true;
  state.error = "";
  const seen = transcriptState().count;
  view.redraw();
  try {
    const result = safe(await askAi({ kind: "answer", instruction: request }));
    state.seen = seen;
    state.at = Date.now();
    state.busy = false;
    // la richiesta può essere cambiata nel frattempo: la risposta vale solo per quella fatta
    if (view.data.request.trim() === request) view.set({ request: view.data.request, result });
    else view.redraw();
  } catch (e) {
    state.busy = false;
    state.error = errorText(e);
    view.redraw();
  }
}

/** La trascrizione è cresciuta: prepara il prossimo ricalcolo. */
function schedule(view: BlockView<LiveAi>) {
  const state = view.local.ai as Running;
  const { count, live } = transcriptState();
  if (!view.data.request.trim() || count <= state.seen || state.timer !== null) return;
  const wait = live ? Math.max(SETTLE_MS, LIVE_EVERY_MS - (Date.now() - state.at)) : SETTLE_MS;
  state.timer = window.setTimeout(() => {
    state.timer = null;
    if (transcriptState().count > state.seen) run(view);
  }, wait);
}

function render(view: BlockView<LiveAi>) {
  const { data } = view;
  let state = view.local.ai as Running | undefined;
  if (!state) {
    // aprendo una nota la risposta salvata resta com'è: si ricalcola solo se arriva altra trascrizione
    state = { busy: false, error: "", seen: transcriptState().count, at: 0, timer: null };
    view.local.ai = state;
    const stop = onTranscript(() => schedule(view));
    view.cleanup.push(stop, () => state!.timer !== null && window.clearTimeout(state!.timer));
  }
  const editable = view.editor.isEditable;
  const live = transcriptState().live;

  const body = h("div", { class: "ai-result md" });
  if (data.result) body.innerHTML = DOMPurify.sanitize(marked.parse(data.result, { async: false, gfm: true, breaks: true }) as string);
  else {
    body.classList.add("empty");
    body.textContent = state.busy
      ? t("Leggo la trascrizione…")
      : data.request
        ? t("Premi Invio per chiedere")
        : t("Scrivi una richiesta: la risposta si aggiorna mentre la riunione procede");
  }

  const request = field(
    data.request,
    // uscendo dal campo la richiesta si salva soltanto: a chiedere è Invio
    (value) => view.set({ ...data, request: value.replace(/\s+/g, " ").trim() }),
    {
      class: "ai-request",
      readOnly: !editable,
      placeholder: t("Chiedi all'AI, es. riassumi le obiezioni del cliente"),
      attrs: { "data-focus": "request", "aria-label": t("Richiesta per l'AI") },
      // Invio senza modifiche: chiede di nuovo
      onEnter: (value) => {
        const next = value.replace(/\s+/g, " ").trim();
        if (next !== data.request) view.set({ ...data, request: next });
        queueMicrotask(() => run(view));
      },
    },
  );

  // un ridisegno butta via il pulsante: la dettatura in corso lì non avrebbe più dove scrivere
  (view.local.mic as { cancel(): void } | undefined)?.cancel();
  const mic = micButton(request);
  view.local.mic = mic;

  view.dom.classList.toggle("busy", state.busy);
  view.dom.replaceChildren(
    h(
      "div",
      { class: "ai-head" },
      h("span", { class: "ai-mark", attrs: { "aria-hidden": "true" } }, sparklesEl()),
      request,
      ...(editable ? [mic.button] : []),
      live ? h("span", { class: "ai-live", title: t("Si aggiorna da sola mentre registri, al massimo ogni due minuti") }, t("● dal vivo")) : null,
      h(
        "button",
        {
          type: "button",
          class: "block-btn",
          title: t("Ricalcola ora"),
          disabled: state.busy || !data.request.trim() || !editable,
          on: { click: () => run(view) },
        },
        "↻",
      ),
    ),
    body,
    ...(state.error ? [h("div", { class: "ai-error" }, state.error)] : []),
  );
}

/**
 * Blocco AI dal vivo: una richiesta e la sua risposta, ricalcolata mentre la trascrizione
 * cresce. In Markdown:
 *
 *     ::: ai Riassumi le obiezioni del cliente
 *     - Il prezzo è più alto del concorrente
 *     - Serve l'integrazione entro gennaio
 *     :::
 */
const LiveAiBlock = dataBlock<LiveAi>({
  name: "liveAi",
  tag: "ai",
  empty: { request: "", result: "" },
  autofocus: "request",
  format: {
    kind: "container",
    parse: (info, lines) => ({ request: info, result: lines.join("\n").trim() }),
    write: (data) => ({ info: data.request, lines: data.result ? safe(data.result).split("\n") : [] }),
  },
  render,
});

/** Pannello della barra di selezione: l'AI riscrive il testo selezionato secondo la richiesta. */
function RewritePanel({ editor, close }: { editor: Editor; close: () => void }) {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const dictation = useRef<ReturnType<typeof createDictation>>();
  dictation.current ??= createDictation(setPhase, (text) => {
    setAsk((old) => (old.trim() ? `${old.trim()} ${text}` : text));
    input.current?.focus();
  });
  useEffect(() => () => dictation.current?.cancel(), []);

  const apply = async () => {
    const { from, to } = editor.state.selection;
    const current = editor.state.doc.textBetween(from, to, "\n", " ");
    if (!ask.trim() || !current.trim() || busy) return;
    setBusy(true);
    try {
      const text = await askAi({ kind: "rewrite", instruction: ask.trim(), current });
      // la nota può essere cambiata mentre l'AI scriveva: si sostituisce solo se il testo è ancora quello
      const size = editor.state.doc.content.size;
      if (to <= size && editor.state.doc.textBetween(from, to, "\n", " ") === current) {
        editor.chain().focus().insertContentAt({ from, to }, text.trim()).run();
      } else notify(t("La nota è cambiata nel frattempo: il testo non è stato sostituito"));
      close();
    } catch (e) {
      notify(errorText(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="tb-panel"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <input
        ref={input}
        value={ask}
        disabled={busy}
        placeholder={busy ? t("L'AI sta scrivendo…") : t("Chiedi all'AI: accorcia, traduci, riscrivi…")}
        aria-label={t("Richiesta per l'AI")}
        onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            editor.commands.focus();
            close();
          }
        }}
      />
      <button
        type="button"
        className={"tb-btn mic-btn" + (phase === "listening" ? " on" : "")}
        title={micTitle(phase)}
        aria-label={micTitle(phase)}
        disabled={busy || phase === "transcribing"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => dictation.current?.toggle()}
        dangerouslySetInnerHTML={{ __html: micContent(phase) }}
      />
      <button type="submit" className="tb-btn" title={t("Applica")} disabled={busy}>
        ↵
      </button>
    </form>
  );
}

export const ai: EditorPlugin = {
  name: "ai",
  extensions: () => [LiveAiBlock],
  commands: [
    {
      id: "live-ai",
      get title() {
        return t("Chiedi all'AI");
      },
      get hint() {
        return t("Una richiesta sul meeting, che si aggiorna da sola");
      },
      icon: "✦",
      get group() {
        return t("Meeting");
      },
      keywords: ["ai", "chiedi", "ask", "riassumi", "riassunto", "summary", "live", "dal vivo", "claude"],
      run: (e) => e.chain().focus().insertContent({ type: "liveAi" }).run(),
    },
  ],
  toolbar: [
    {
      id: "ai-rewrite",
      group: "ai",
      label: "✦",
      get title() {
        return t("Riscrivi con l'AI");
      },
      panel: RewritePanel,
    },
  ],
};
