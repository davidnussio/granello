import { dataBlock, type BlockView } from "../dataBlock";
import { field, h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface ProsCons {
  pros: string[];
  cons: string[];
  verdict: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function render(view: BlockView<ProsCons>) {
  const { data } = view;

  const column = (side: "pros" | "cons", title: string, sign: string) =>
    h(
      "div",
      { class: `pc-column ${side}` },
      h("div", { class: "pc-title" }, title, h("span", { class: "pc-count" }, data[side].length)),
      ...data[side].map((item, i) =>
        h(
          "div",
          { class: "pc-item" },
          h("span", { class: "pc-sign" }, sign),
          field(item, (text) => view.set({ ...data, [side]: data[side].map((x, j) => (j === i ? clean(text) : x)) }), {
            attrs: { "aria-label": title },
          }),
          h(
            "button",
            {
              type: "button",
              class: "block-btn remove",
              title: t("Togli"),
              on: { click: () => view.set({ ...data, [side]: data[side].filter((_, j) => j !== i) }) },
            },
            "×",
          ),
        ),
      ),
      h(
        "div",
        { class: "pc-item new" },
        h("span", { class: "pc-sign" }, sign),
        field("", () => {}, {
          placeholder: t("Aggiungi, poi Invio"),
          attrs: { "data-focus": `new-${side}`, "aria-label": title },
          onEnter: (text) => {
            if (clean(text)) view.set({ ...data, [side]: [...data[side], clean(text)] }, `new-${side}`);
          },
        }),
      ),
    );

  view.dom.replaceChildren(
    h("div", { class: "pros-cons" }, column("pros", t("Pro"), "+"), column("cons", t("Contro"), "−")),
    h(
      "div",
      { class: "pc-verdict" },
      h("span", {}, t("Verdetto")),
      field(data.verdict, (verdict) => view.set({ ...data, verdict: clean(verdict) }), {
        placeholder: t("Cosa si decide, alla fine"),
        attrs: { "aria-label": t("Verdetto") },
      }),
    ),
  );
}

/**
 * Pro e contro affiancati, con un verdetto. In Markdown:
 *
 *     ::: pros-cons
 *     + Costa meno
 *     - Serve una migrazione
 *     = Si fa, dopo il rilascio
 *     :::
 */
const ProsConsBlock = dataBlock<ProsCons>({
  name: "prosCons",
  tag: "pros-cons",
  empty: { pros: [], cons: [], verdict: "" },
  autofocus: "new-pros",
  ai: {
    format: "::: pros-cons\n+ Un pro\n+ Un altro pro\n- Un contro\n= Il verdetto, in una riga\n:::\n\nLe righe con \"+\" sono i pro, quelle con \"-\" i contro; la riga con \"=\" è il verdetto (facoltativa, una sola).",
  },
  format: {
    kind: "container",
    parse: (_info, lines) => {
      const data: ProsCons = { pros: [], cons: [], verdict: "" };
      for (const raw of lines) {
        const m = /^([+\-−=])\s*(.*)$/.exec(raw.trim());
        if (!m || !m[2]) continue;
        if (m[1] === "+") data.pros.push(m[2]);
        else if (m[1] === "=") data.verdict = m[2];
        else data.cons.push(m[2]);
      }
      return data;
    },
    write: (data) => ({
      lines: [
        ...data.pros.map((p) => `+ ${p}`),
        ...data.cons.map((c) => `- ${c}`),
        ...(data.verdict ? [`= ${data.verdict}`] : []),
      ],
    }),
  },
  render,
});

export const prosCons: EditorPlugin = {
  name: "prosCons",
  extensions: () => [ProsConsBlock],
  commands: [
    {
      id: "pros-cons",
      get title() {
        return t("Pro e contro");
      },
      get hint() {
        return t("Due colonne e un verdetto");
      },
      icon: "±",
      get group() {
        return t("Strumenti");
      },
      keywords: ["pro", "contro", "pros", "cons", "vantaggi", "svantaggi", "confronto"],
      run: (e) => e.chain().focus().insertContent({ type: "prosCons" }).run(),
    },
  ],
};
