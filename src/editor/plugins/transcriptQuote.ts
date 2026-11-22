import type { Editor } from "@tiptap/react";
import { dataBlock, type BlockView } from "../dataBlock";
import { area, field, h } from "../dom";
import { insertAside, oneLine, parseTime, QUOTE_FROM_SLASH, showInTranscript } from "../meeting";
import { mmss } from "../../format";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

/** Una frase detta nel meeting, presa dalla trascrizione. */
export interface TranscriptQuote {
  /** Millisecondi dall'inizio del meeting, sulla stessa scala della trascrizione. */
  ms: number;
  /** Chi l'ha detta: parte da "Altri" o dal nome dell'utente, e si può correggere. */
  who: string;
  text: string;
}

/** Il blocco così com'è scritto in Markdown. */
export function quoteMd(quote: TranscriptQuote): string {
  return `::: quote ${oneLine(`${mmss(quote.ms)} ${quote.who}`)}\n${oneLine(quote.text)}\n:::`;
}

/** Mette la citazione nella nota senza spostare il cursore. */
export function insertQuote(editor: Editor, quote: TranscriptQuote) {
  const data = { ms: quote.ms, who: oneLine(quote.who), text: oneLine(quote.text) };
  insertAside(editor, editor.state.schema.nodes.transcriptQuote.create({ data }));
}

function render(view: BlockView<TranscriptQuote>) {
  const { data } = view;
  const editable = view.editor.isEditable;
  view.dom.replaceChildren(
    h("span", { class: "tq-mark", attrs: { "aria-hidden": "true" } }, "❝"),
    h(
      "div",
      { class: "tq-body" },
      area(data.text, (text) => view.set({ ...data, text }), {
        class: "tq-text",
        readOnly: !editable,
        placeholder: t("La frase detta nel meeting"),
        attrs: { "data-focus": "text", "aria-label": t("La frase detta nel meeting") },
      }),
      h(
        "div",
        { class: "tq-source" },
        "— ",
        field(data.who, (who) => view.set({ ...data, who: oneLine(who) }), {
          class: "tq-who",
          readOnly: !editable,
          placeholder: t("Chi l'ha detto"),
          attrs: { "data-focus": "who", "aria-label": t("Chi l'ha detto") },
        }),
        field(
          mmss(data.ms),
          (value) => {
            const ms = parseTime(value);
            if (ms !== null) view.set({ ...data, ms });
            else render(view);
          },
          {
            class: "tq-time",
            readOnly: !editable,
            title: t("Minuto del meeting (minuti:secondi)"),
            attrs: { "data-focus": "time", "aria-label": t("Minuto del meeting") },
          },
        ),
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
      ),
    ),
  );
}

/**
 * Citazione dalla trascrizione: la frase, chi l'ha detta e il minuto. Si crea selezionando
 * il testo nel pannello della trascrizione, con "Cita l'ultima frase" mentre si registra, o dal
 * menu "/" (vuota, al minuto attuale della registrazione). In Markdown:
 *
 *     ::: quote 12:34 Marco
 *     Lo sconto del 10% vale solo fino a gennaio.
 *     :::
 */
const QuoteBlock = dataBlock<TranscriptQuote>({
  name: "transcriptQuote",
  tag: "quote",
  empty: { ms: 0, who: "", text: "" },
  autofocus: "text",
  // dal comando "/" durante la registrazione arriva già con il minuto: è vuota lo stesso
  isEmpty: (data) => !data.who && !data.text,
  format: {
    kind: "container",
    parse: (info, lines) => {
      const m = /^([\d:]+)\s*(.*)$/.exec(info);
      const ms = m ? parseTime(m[1]) : null;
      return { ms: ms ?? 0, who: ms === null ? info : m![2], text: oneLine(lines.join(" ")) };
    },
    write: (data) => ({
      info: `${mmss(data.ms)} ${data.who}`,
      lines: data.text.trim() ? [oneLine(data.text)] : [],
    }),
  },
  render,
});

export const transcriptQuote: EditorPlugin = {
  name: "transcriptQuote",
  extensions: () => [QuoteBlock],
  commands: [
    {
      id: "transcript-quote",
      get title() {
        return t("Citazione dalla trascrizione");
      },
      get hint() {
        return t("Una frase detta, con chi e a che minuto");
      },
      icon: "❝",
      get group() {
        return t("Meeting");
      },
      keywords: ["citazione", "trascrizione", "quote", "transcript", "frase", "detto"],
      run: (e) => {
        const ask = new CustomEvent<Editor>(QUOTE_FROM_SLASH, { detail: e, cancelable: true });
        if (window.dispatchEvent(ask)) e.chain().focus().insertContent({ type: "transcriptQuote" }).run();
      },
    },
  ],
};
