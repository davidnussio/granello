import type { Editor } from "@tiptap/react";
import { dataBlock, type BlockView } from "../dataBlock";
import { area, field, h } from "../dom";
import { mmss } from "../../format";
import { t } from "../../i18n";
import { SHOW_IN_TRANSCRIPT, insertAside, oneLine, parseTime, showInTranscript } from "../meeting";
import type { EditorPlugin } from "../types";

interface Moment {
  /** Millisecondi dall'inizio del meeting, sulla stessa scala della trascrizione. */
  ms: number;
  /** Cosa si stava dicendo: lo scrive l'utente oppure l'AI a fine riunione. */
  text: string;
}

/** Un momento riempito dall'AI. */
export interface MomentFill {
  ms: number;
  text: string;
}

/** Eventi con cui il blocco parla con la pagina del meeting, che sa cose che l'editor non sa. */
export const MOMENT_EVENTS = {
  /** Segna il momento attuale. `detail`: l'editor da cui parte la richiesta, se c'è. */
  mark: "granello:mark-moment",
  /** Chiedi all'AI di riempire i momenti vuoti. */
  fill: "granello:fill-moments",
  /** Mostra la trascrizione a quel punto. `detail`: i millisecondi. */
  show: SHOW_IN_TRANSCRIPT,
} as const;

/** Il blocco così com'è scritto in Markdown. */
export function momentMd(ms: number, text = ""): string {
  const body = oneLine(text);
  return `::: moment ${mmss(ms)}\n${body ? body + "\n" : ""}:::`;
}

const EMPTY_MOMENT = /^([ \t>]*):{3,} *moment +([\d:]+) *\n[ \t>]*:{3,} *$/gm;

/** I momenti ancora vuoti in una nota in Markdown. */
export function emptyMoments(md: string): number[] {
  const out: number[] = [];
  for (const m of md.matchAll(EMPTY_MOMENT)) {
    const ms = parseTime(m[2]);
    if (ms !== null && !out.includes(ms)) out.push(ms);
  }
  return out;
}

/** Riempie i momenti vuoti di una nota in Markdown (quando l'editor non è aperto). */
export function fillMomentsMd(md: string, fills: MomentFill[]): string {
  return md.replace(EMPTY_MOMENT, (whole, prefix: string, time: string) => {
    // in Markdown il tempo è al secondo: si confronta così
    const fill = fills.find((f) => mmss(f.ms) === mmss(parseTime(time) ?? -1));
    return fill ? momentMd(fill.ms, fill.text).split("\n").map((line) => prefix + line).join("\n") : whole;
  });
}

/** Riempie i momenti vuoti nell'editor aperto. Ritorna quanti ne ha riempiti. */
export function fillMomentsIn(editor: Editor, fills: MomentFill[]): number {
  const tr = editor.state.tr;
  let count = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "moment") return;
    const data = node.attrs.data as Moment;
    const fill = data.text.trim() ? undefined : fills.find((f) => mmss(f.ms) === mmss(data.ms));
    if (!fill) return;
    tr.setNodeMarkup(pos, undefined, { data: { ms: data.ms, text: oneLine(fill.text) } });
    count++;
  });
  if (count) editor.view.dispatch(tr);
  return count;
}

/** Mette il marcatore nella nota senza spostare il cursore. */
export function insertMoment(editor: Editor, ms: number) {
  insertAside(editor, editor.state.schema.nodes.moment.create({ data: { ms, text: "" } }));
}

function render(view: BlockView<Moment>) {
  const { data } = view;
  const editable = view.editor.isEditable;
  const filled = data.text.trim().length > 0;
  view.dom.classList.toggle("empty", !filled);

  const text = area(data.text, (next) => view.set({ ...data, text: next }), {
    class: "moment-text",
    readOnly: !editable,
    placeholder: t("Cosa si stava dicendo? A fine riunione lo scrive l'AI"),
    attrs: { "data-focus": "text", "aria-label": t("Cosa si stava dicendo in quel momento") },
  });

  view.dom.replaceChildren(
    h("span", { class: "moment-flag", attrs: { "aria-hidden": "true" } }, "⚑"),
    field(
      mmss(data.ms),
      (value) => {
        const ms = parseTime(value);
        if (ms !== null) view.set({ ...data, ms });
        else render(view);
      },
      {
        class: "moment-time",
        readOnly: !editable,
        title: t("Minuto del meeting (minuti:secondi)"),
        attrs: { "data-focus": "time", "aria-label": t("Minuto del meeting") },
      },
    ),
    text,
    ...(!filled && editable
      ? [
          h(
            "button",
            {
              type: "button",
              class: "block-btn",
              title: t("Fai scrivere all'AI cosa si stava dicendo"),
              on: { click: () => window.dispatchEvent(new CustomEvent(MOMENT_EVENTS.fill)) },
            },
            "✦",
          ),
        ]
      : []),
    h(
      "button",
      {
        type: "button",
        class: "block-btn",
        title: t("Apri la trascrizione a questo punto"),
        on: { click: () => showInTranscript(data.ms) },
      },
      "↗",
    ),
  );
}

/**
 * Un momento segnato durante la registrazione: il minuto e, dopo, cosa si stava dicendo.
 * In Markdown:
 *
 *     ::: moment 12:34
 *     Il cliente chiede lo sconto del 10% entro gennaio.
 *     :::
 */
const MomentBlock = dataBlock<Moment>({
  name: "moment",
  tag: "moment",
  empty: { ms: 0, text: "" },
  autofocus: "time",
  format: {
    kind: "container",
    parse: (info, lines) => ({ ms: parseTime(info) ?? 0, text: oneLine(lines.join(" ")) }),
    write: (data) => ({ info: mmss(data.ms), lines: data.text.trim() ? [oneLine(data.text)] : [] }),
  },
  render,
});

export const moment: EditorPlugin = {
  name: "moment",
  extensions: () => [MomentBlock],
  commands: [
    {
      id: "moment",
      get title() {
        return t("Segna il momento");
      },
      get hint() {
        return t("Il minuto della registrazione; l'AI aggiunge cosa si diceva");
      },
      icon: "⚑",
      get group() {
        return t("Meeting");
      },
      keywords: ["momento", "marcatore", "segna", "moment", "marker", "flag", "bandierina", "timestamp", "minuto"],
      run: (e) => {
        e.commands.focus();
        window.dispatchEvent(new CustomEvent<Editor>(MOMENT_EVENTS.mark, { detail: e }));
      },
    },
  ],
};
