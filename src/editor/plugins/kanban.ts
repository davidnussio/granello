import { dataBlock, type BlockView } from "../dataBlock";
import { area, field, h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Kanban {
  columns: { title: string; cards: string[] }[];
}

/** La scheda che si sta trascinando: da quale blocco, colonna e posizione. */
let dragging: { view: BlockView<Kanban>; column: number; card: number } | null = null;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function move(data: Kanban, from: { column: number; card: number }, to: number): Kanban {
  const text = data.columns[from.column].cards[from.card];
  return {
    columns: data.columns.map((c, i) => {
      let cards = i === from.column ? c.cards.filter((_, j) => j !== from.card) : c.cards;
      if (i === to) cards = [...cards, text];
      return { ...c, cards };
    }),
  };
}

function render(view: BlockView<Kanban>) {
  const { data } = view;
  const withColumn = (i: number, patch: Partial<Kanban["columns"][number]>): Kanban => ({
    columns: data.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)),
  });

  view.dom.replaceChildren(
    h(
      "div",
      { class: "kanban" },
      ...data.columns.map((column, ci) =>
        h(
          "div",
          {
            class: "kanban-column",
            on: {
              dragover: (e) => {
                if (dragging?.view === view) e.preventDefault();
              },
              drop: (e) => {
                e.preventDefault();
                if (dragging?.view !== view || dragging.column === ci) return;
                view.set(move(data, dragging, ci));
              },
            },
          },
          h(
            "div",
            { class: "kanban-head" },
            field(column.title, (title) => view.set(withColumn(ci, { title: clean(title) })), {
              class: "kanban-title",
              placeholder: t("Colonna"),
              attrs: { "aria-label": t("Nome della colonna") },
            }),
            h("span", { class: "kanban-count" }, column.cards.length),
          ),
          ...column.cards.map((card, i) =>
            h(
              "div",
              {
                class: "kanban-card",
                draggable: true,
                on: {
                  dragstart: (e) => {
                    dragging = { view, column: ci, card: i };
                    e.dataTransfer?.setData("text/plain", card);
                  },
                  dragend: () => {
                    dragging = null;
                  },
                },
              },
              // su più righe: il testo di una scheda va a capo invece di essere tagliato
              area(card, (text) => view.set(withColumn(ci, { cards: column.cards.map((c, j) => (j === i ? clean(text) : c)) })), {
                attrs: { "aria-label": t("Scheda") },
              }),
              // chi non trascina sposta con le frecce
              h(
                "button",
                {
                  type: "button",
                  class: "block-btn remove",
                  title: t("Sposta a sinistra"),
                  disabled: ci === 0,
                  on: { click: () => view.set(move(data, { column: ci, card: i }, ci - 1)) },
                },
                "‹",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "block-btn remove",
                  title: t("Sposta a destra"),
                  disabled: ci === data.columns.length - 1,
                  on: { click: () => view.set(move(data, { column: ci, card: i }, ci + 1)) },
                },
                "›",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "block-btn remove",
                  title: t("Elimina la scheda"),
                  on: { click: () => view.set(withColumn(ci, { cards: column.cards.filter((_, j) => j !== i) })) },
                },
                "×",
              ),
            ),
          ),
          field("", () => {}, {
            class: "kanban-new",
            placeholder: t("+ Scheda"),
            attrs: { "data-focus": `new-${ci}`, "aria-label": t("Nuova scheda") },
            onEnter: (text) => {
              if (clean(text)) view.set(withColumn(ci, { cards: [...column.cards, clean(text)] }), `new-${ci}`);
            },
          }),
        ),
      ),
    ),
  );
}

/**
 * Lavagna a colonne con schede da spostare. In Markdown:
 *
 *     ::: kanban
 *     ## Da fare
 *     - Scrivere i test
 *     ## Fatto
 *     :::
 */
const KanbanBlock = dataBlock<Kanban>({
  name: "kanban",
  tag: "kanban",
  empty: { columns: [] },
  autofocus: "new-0",
  ai: {
    format: "::: kanban\n## Da fare\n- Una scheda\n- Un'altra scheda\n## In corso\n## Fatto\n- Scheda conclusa\n:::\n\nOgni riga \"## Titolo\" apre una colonna; le righe \"- testo\" sotto sono le sue schede, una riga ciascuna.",
  },
  format: {
    kind: "container",
    parse: (_info, lines) => {
      const columns: Kanban["columns"] = [];
      for (const raw of lines) {
        const line = raw.trim();
        const head = /^#{1,6}\s+(.*)$/.exec(line);
        const card = /^[-*]\s+(.*)$/.exec(line);
        if (head) columns.push({ title: head[1], cards: [] });
        else if (card && columns.length) columns[columns.length - 1].cards.push(card[1]);
      }
      return { columns };
    },
    write: (data) => ({
      lines: data.columns.flatMap((c) => [`## ${c.title || "-"}`, ...c.cards.map((card) => `- ${card}`)]),
    }),
  },
  render,
});

export const kanban: EditorPlugin = {
  name: "kanban",
  extensions: () => [KanbanBlock],
  commands: [
    {
      id: "kanban",
      get title() {
        return t("Lavagna a colonne");
      },
      get hint() {
        return t("Da fare, in corso, fatto");
      },
      icon: "▥",
      get group() {
        return t("Strumenti");
      },
      keywords: ["kanban", "lavagna", "board", "colonne", "schede", "stato"],
      run: (e) =>
        e
          .chain()
          .focus()
          .insertContent({
            type: "kanban",
            attrs: {
              data: {
                columns: [t("Da fare"), t("In corso"), t("Fatto")].map((title) => ({ title, cards: [] })),
              },
            },
          })
          .run(),
    },
  ],
};
