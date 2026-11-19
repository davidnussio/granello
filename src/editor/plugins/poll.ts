import { dataBlock, type BlockView } from "../dataBlock";
import { field, h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Poll {
  question: string;
  options: { text: string; votes: number }[];
}

const empty: Poll = { question: "", options: [{ text: "", votes: 0 }, { text: "", votes: 0 }] };

function render(view: BlockView<Poll>) {
  const { data } = view;
  const total = data.options.reduce((sum, o) => sum + o.votes, 0);
  const top = Math.max(0, ...data.options.map((o) => o.votes));
  const withOption = (i: number, patch: Partial<Poll["options"][number]>) => ({
    ...data,
    options: data.options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
  });

  view.dom.replaceChildren(
    field(data.question, (question) => view.set({ ...data, question }), {
      class: "poll-question",
      placeholder: t("Domanda del sondaggio"),
      attrs: { "data-focus": "question", "aria-label": t("Domanda del sondaggio") },
    }),
    ...data.options.map((o, i) => {
      const share = total ? Math.round((o.votes / total) * 100) : 0;
      return h(
        "div",
        { class: "poll-option" + (o.votes > 0 && o.votes === top ? " winning" : "") },
        h("span", { class: "poll-bar", style: `width: ${share}%` }),
        field(o.text, (text) => view.set(withOption(i, { text })), {
          placeholder: t("Opzione {n}", { n: i + 1 }),
          attrs: { "data-focus": `option-${i}`, "aria-label": t("Opzione {n}", { n: i + 1 }) },
        }),
        h("span", { class: "poll-share" }, total ? `${share}%` : ""),
        h(
          "button",
          {
            type: "button",
            class: "block-btn",
            title: t("Togli un voto"),
            disabled: o.votes === 0,
            on: { click: () => view.set(withOption(i, { votes: Math.max(0, o.votes - 1) })) },
          },
          "−",
        ),
        h("span", { class: "poll-votes", title: t("Voti") }, o.votes),
        h(
          "button",
          { type: "button", class: "block-btn", title: t("Aggiungi un voto"), on: { click: () => view.set(withOption(i, { votes: o.votes + 1 })) } },
          "+",
        ),
        h(
          "button",
          {
            type: "button",
            class: "block-btn remove",
            title: t("Togli l'opzione"),
            on: { click: () => view.set({ ...data, options: data.options.filter((_, j) => j !== i) }) },
          },
          "×",
        ),
      );
    }),
    h(
      "div",
      { class: "block-foot" },
      h(
        "button",
        {
          type: "button",
          class: "block-add",
          on: {
            click: () =>
              view.set({ ...data, options: [...data.options, { text: "", votes: 0 }] }, `option-${data.options.length}`),
          },
        },
        t("+ Opzione"),
      ),
      h("span", { class: "block-note" }, t("{n} voti", { n: total })),
    ),
  );
}

/**
 * Sondaggio: una domanda, le opzioni e i voti raccolti in riunione. In Markdown:
 *
 *     ::: poll Quando rilasciamo?
 *     - [3] Giovedì
 *     - [1] Lunedì
 *     :::
 */
const PollBlock = dataBlock<Poll>({
  name: "poll",
  tag: "poll",
  empty,
  autofocus: "question",
  format: {
    kind: "container",
    parse: (info, lines) => ({
      question: info,
      options: lines.flatMap((line) => {
        const m = /^[-*]\s*\[(\d+)\]\s*(.*)$/.exec(line.trim());
        return m ? [{ votes: Number(m[1]), text: m[2] }] : [];
      }),
    }),
    write: (data) => ({
      info: data.question,
      lines: data.options.map((o) => `- [${o.votes}] ${o.text.replace(/\s+/g, " ").trim()}`),
    }),
  },
  render,
});

export const poll: EditorPlugin = {
  name: "poll",
  extensions: () => [PollBlock],
  commands: [
    {
      id: "poll",
      get title() {
        return t("Sondaggio");
      },
      get hint() {
        return t("Una domanda, le opzioni, i voti");
      },
      icon: "◔",
      get group() {
        return t("Strumenti");
      },
      keywords: ["sondaggio", "poll", "voto", "votazione", "vote"],
      run: (e) => e.chain().focus().insertContent({ type: "poll" }).run(),
    },
  ],
};
