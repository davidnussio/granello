import { dataBlock, type BlockView } from "../dataBlock";
import { field, h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Matrix {
  options: string[];
  /** Un punteggio per opzione, nello stesso ordine. */
  criteria: { name: string; weight: number; scores: number[] }[];
}

const clean = (s: string) => s.replace(/[|\n]/g, " ").replace(/\s+/g, " ").trim();
const number = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const show = (n: number) => String(Math.round(n * 100) / 100);

export function totals(data: Matrix): number[] {
  return data.options.map((_, i) => data.criteria.reduce((sum, c) => sum + c.weight * (c.scores[i] ?? 0), 0));
}

function render(view: BlockView<Matrix>) {
  const { data } = view;
  const sums = totals(data);
  const best = Math.max(...sums, 0);
  const withCriterion = (i: number, patch: Partial<Matrix["criteria"][number]>): Matrix => ({
    ...data,
    criteria: data.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)),
  });
  const num = (value: number, onCommit: (n: number) => void, label: string) =>
    field(show(value), (v) => onCommit(number(v)), { class: "matrix-num", inputMode: "decimal", attrs: { "aria-label": label } });

  view.dom.replaceChildren(
    h(
      "table",
      { class: "matrix" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, t("Criterio")),
          h("th", { class: "matrix-weight", title: t("Quanto conta il criterio") }, t("Peso")),
          ...data.options.map((option, i) =>
            h(
              "th",
              {},
              field(option, (name) => view.set({ ...data, options: data.options.map((o, j) => (j === i ? clean(name) : o)) }), {
                placeholder: t("Opzione {n}", { n: i + 1 }),
                attrs: { "data-focus": `option-${i}`, "aria-label": t("Opzione {n}", { n: i + 1 }) },
              }),
              h(
                "button",
                {
                  type: "button",
                  class: "block-btn remove",
                  title: t("Togli l'opzione"),
                  on: {
                    click: () =>
                      view.set({
                        options: data.options.filter((_, j) => j !== i),
                        criteria: data.criteria.map((c) => ({ ...c, scores: c.scores.filter((_, j) => j !== i) })),
                      }),
                  },
                },
                "×",
              ),
            ),
          ),
          h("th", { class: "matrix-end" }),
        ),
      ),
      h(
        "tbody",
        {},
        ...data.criteria.map((c, i) =>
          h(
            "tr",
            {},
            h(
              "td",
              {},
              field(c.name, (name) => view.set(withCriterion(i, { name: clean(name) })), {
                placeholder: t("Criterio"),
                attrs: { "data-focus": `criterion-${i}`, "aria-label": t("Criterio") },
              }),
            ),
            h("td", { class: "matrix-weight" }, num(c.weight, (weight) => view.set(withCriterion(i, { weight })), t("Peso"))),
            ...data.options.map((option, j) =>
              h(
                "td",
                {},
                num(
                  c.scores[j] ?? 0,
                  (score) => view.set(withCriterion(i, { scores: data.options.map((_, k) => (k === j ? score : c.scores[k] ?? 0)) })),
                  `${c.name} · ${option}`,
                ),
              ),
            ),
            h(
              "td",
              { class: "matrix-end" },
              h(
                "button",
                {
                  type: "button",
                  class: "block-btn remove",
                  title: t("Togli il criterio"),
                  on: { click: () => view.set({ ...data, criteria: data.criteria.filter((_, j) => j !== i) }) },
                },
                "×",
              ),
            ),
          ),
        ),
      ),
      h(
        "tfoot",
        {},
        h(
          "tr",
          {},
          h("td", {}, t("Totale")),
          h("td", { class: "matrix-weight" }),
          ...sums.map((sum) => h("td", { class: "matrix-total" + (sum > 0 && sum === best ? " best" : "") }, show(sum))),
          h("td", { class: "matrix-end" }),
        ),
      ),
    ),
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
              view.set(
                { ...data, criteria: [...data.criteria, { name: "", weight: 1, scores: data.options.map(() => 0) }] },
                `criterion-${data.criteria.length}`,
              ),
          },
        },
        t("+ Criterio"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "block-add",
          on: {
            click: () =>
              view.set(
                { options: [...data.options, ""], criteria: data.criteria.map((c) => ({ ...c, scores: [...c.scores, 0] })) },
                `option-${data.options.length}`,
              ),
          },
        },
        t("+ Opzione"),
      ),
      h("span", { class: "block-note" }, t("Totale = somma di peso × punteggio")),
    ),
  );
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/**
 * Matrice di decisione: opzioni a confronto su criteri pesati, con il totale. In Markdown è
 * una tabella dentro un contenitore:
 *
 *     ::: matrix
 *     | Criterio | Peso | Soluzione A | Soluzione B |
 *     | --- | --- | --- | --- |
 *     | Costo | 3 | 4 | 2 |
 *     :::
 */
const MatrixBlock = dataBlock<Matrix>({
  name: "matrix",
  tag: "matrix",
  empty: { options: [], criteria: [] },
  ai: {
    format: "::: matrix\n| Criterio | Peso | Opzione A | Opzione B |\n| --- | --- | --- | --- |\n| Costo | 3 | 4 | 2 |\n| Tempi | 2 | 3 | 5 |\n:::\n\nUna tabella: le prime due colonne sono il criterio e il suo peso (da 1 a 5), le altre sono le opzioni a confronto. In ogni cella il voto dell'opzione su quel criterio, da 0 a 5. Il totale non va scritto: lo calcola l'app.",
  },
  format: {
    kind: "container",
    parse: (_info, lines) => {
      const rows = lines.filter((l) => l.trim().startsWith("|")).map(cells);
      const [head, ...rest] = rows;
      if (!head) return { options: [], criteria: [] };
      // "-" è come si scrive un nome lasciato vuoto
      const name = (cell: string | undefined) => (cell === "-" ? "" : cell ?? "");
      const options = head.slice(2).map(name);
      return {
        options,
        criteria: rest
          .filter((r) => !r.every((c) => /^:?-+:?$/.test(c)))
          .map((r) => ({ name: name(r[0]), weight: number(r[1] ?? "1"), scores: options.map((_, i) => number(r[i + 2] ?? "0")) })),
      };
    },
    write: (data) => {
      const row = (values: string[]) => `| ${values.join(" | ")} |`;
      return {
        lines: [
          row([t("Criterio"), t("Peso"), ...data.options.map((o) => clean(o) || "-")]),
          row(["---", "---", ...data.options.map(() => "---")]),
          ...data.criteria.map((c) => row([clean(c.name) || "-", show(c.weight), ...data.options.map((_, i) => show(c.scores[i] ?? 0))])),
        ],
      };
    },
  },
  render,
});

export const matrix: EditorPlugin = {
  name: "matrix",
  extensions: () => [MatrixBlock],
  commands: [
    {
      id: "matrix",
      get title() {
        return t("Matrice di decisione");
      },
      get hint() {
        return t("Opzioni, criteri pesati, totale");
      },
      icon: "▦",
      get group() {
        return t("Strumenti");
      },
      keywords: ["matrice", "decisione", "matrix", "criteri", "pesi", "confronto", "punteggio"],
      run: (e) =>
        e
          .chain()
          .focus()
          .insertContent({
            type: "matrix",
            attrs: {
              data: {
                options: [t("Opzione {n}", { n: 1 }), t("Opzione {n}", { n: 2 })],
                criteria: [{ name: "", weight: 1, scores: [0, 0] }],
              },
            },
          })
          .run(),
    },
  ],
};
