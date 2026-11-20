import { dataBlock, type BlockView } from "../dataBlock";
import { field, h } from "../dom";
import { dayLabel } from "../../format";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Timeline {
  items: { date: string; text: string }[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const sorted = (items: Timeline["items"]) => [...items].sort((a, b) => a.date.localeCompare(b.date));

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function render(view: BlockView<Timeline>) {
  const items = sorted(view.data.items);
  const now = today();
  // la prossima tappa: la prima che non è ancora passata
  const next = items.findIndex((i) => i.date >= now);
  const save = (list: Timeline["items"], focus?: string) => view.set({ items: sorted(list) }, focus);

  const dateInput = (value: string, onChange: (date: string) => void, label: string) =>
    h("input", {
      type: "date",
      value,
      class: "timeline-date-input",
      attrs: { "aria-label": label },
      on: {
        change: (e) => {
          const picked = (e.target as HTMLInputElement).value;
          if (ISO.test(picked)) onChange(picked);
        },
      },
    });

  let newDate = now;
  view.dom.replaceChildren(
    h(
      "div",
      { class: "timeline" },
      ...items.map((item, i) =>
        h(
          "div",
          { class: "timeline-item" + (item.date < now ? " past" : "") + (i === next ? " next" : "") },
          h("span", { class: "timeline-dot" }),
          h(
            "label",
            { class: "timeline-date", title: t("Cambia la data") },
            dayLabel(new Date(`${item.date}T12:00:00`).getTime()),
            dateInput(item.date, (date) => save(items.map((x, j) => (j === i ? { ...x, date } : x))), t("Cambia la data")),
          ),
          field(item.text, (text) => save(items.map((x, j) => (j === i ? { ...x, text: clean(text) } : x))), {
            placeholder: t("Tappa"),
            attrs: { "aria-label": t("Tappa") },
          }),
          h(
            "button",
            {
              type: "button",
              class: "block-btn remove",
              title: t("Togli la tappa"),
              on: { click: () => save(items.filter((_, j) => j !== i)) },
            },
            "×",
          ),
        ),
      ),
      h(
        "div",
        { class: "timeline-item new" },
        h("span", { class: "timeline-dot" }),
        dateInput(now, (date) => (newDate = date), t("Data della nuova tappa")),
        field("", () => {}, {
          placeholder: t("+ Tappa, poi Invio"),
          attrs: { "data-focus": "new", "aria-label": t("Nuova tappa") },
          onEnter: (text) => {
            if (clean(text)) save([...items, { date: newDate, text: clean(text) }], "new");
          },
        }),
      ),
    ),
  );
}

/**
 * Tappe con le loro date, in ordine lungo una linea. In Markdown:
 *
 *     ::: timeline
 *     - 2026-11-26 Rilascio
 *     - 2026-12-10 Go-live
 *     :::
 */
const TimelineBlock = dataBlock<Timeline>({
  name: "timeline",
  tag: "timeline",
  empty: { items: [] },
  autofocus: "new",
  ai: {
    format: "::: timeline\n- 2026-11-26 Rilascio\n- 2026-12-10 Go-live\n:::\n\nUna tappa per riga: la data in formato AAAA-MM-GG, uno spazio, il titolo.",
  },
  format: {
    kind: "container",
    parse: (_info, lines) => ({
      items: sorted(
        lines.flatMap((line) => {
          const m = /^[-*]\s*(\d{4}-\d{2}-\d{2})\s*(.*)$/.exec(line.trim());
          return m ? [{ date: m[1], text: m[2] }] : [];
        }),
      ),
    }),
    write: (data) => ({ lines: sorted(data.items).map((i) => `- ${i.date} ${i.text}`.trim()) }),
  },
  render,
});

export const timeline: EditorPlugin = {
  name: "timeline",
  extensions: () => [TimelineBlock],
  commands: [
    {
      id: "timeline",
      get title() {
        return t("Timeline");
      },
      get hint() {
        return t("Tappe con le loro date");
      },
      icon: "⟶",
      get group() {
        return t("Strumenti");
      },
      keywords: ["timeline", "tappe", "milestone", "scadenze", "roadmap", "date"],
      run: (e) => e.chain().focus().insertContent({ type: "timeline" }).run(),
    },
  ],
};
