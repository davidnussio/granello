import { Node, mergeAttributes } from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import { dayLabel } from "../../format";
import { t } from "../../i18n";
import { once, type MdState } from "../markdown";
import type { EditorPlugin } from "../types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Mezzogiorno locale: il giorno resta quello anche con l'ora legale di mezzo. */
const toTime = (iso: string) => new Date(`${iso}T12:00:00`).getTime();

const pad = (n: number) => String(n).padStart(2, "0");

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function label(iso: string): string {
  return ISO.test(iso) && !Number.isNaN(toTime(iso)) ? dayLabel(toTime(iso)) : iso;
}

/** Una data che resta una data: si legge "Domani" o "giovedì 26 novembre", in Markdown è `[[2026-11-26]]`. */
const DateNode = Node.create({
  name: "date",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      date: {
        default: "",
        parseHTML: (el) => el.getAttribute("datetime") ?? "",
        renderHTML: (attrs) => ({ datetime: attrs.date }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "time[data-date]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "time",
      mergeAttributes(HTMLAttributes, { "data-date": "", class: "date-pill" }),
      label(node.attrs.date),
    ];
  },
  renderText({ node }) {
    return label(node.attrs.date);
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.className = "date-pill";
      dom.contentEditable = "false";
      const text = document.createElement("span");
      // il selettore di data è quello di sistema: il campo c'è ma non si vede
      const input = document.createElement("input");
      input.type = "date";
      input.tabIndex = -1;
      input.setAttribute("aria-label", t("Cambia la data"));
      dom.append(text, input);
      const paint = (iso: string) => {
        text.textContent = label(iso);
        input.value = iso;
        dom.title = iso;
      };
      paint(node.attrs.date);
      dom.addEventListener("click", () => {
        if (!editor.isEditable) return;
        try {
          input.showPicker();
        } catch {
          input.focus();
        }
      });
      input.addEventListener("change", () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number" || !ISO.test(input.value)) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { date: input.value }));
      });
      return {
        dom,
        update(next) {
          if (next.type.name !== "date") return false;
          paint(next.attrs.date);
          return true;
        },
        stopEvent: (e) => e.target === input,
        ignoreMutation: () => true,
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: { attrs: { date: string } }) {
          state.write(`[[${node.attrs.date}]]`);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "date", () => {
              md.inline.ruler.before("link", "date", (state, silent) => {
                const m = /^\[\[(\d{4}-\d{2}-\d{2})\]\]/.exec(state.src.slice(state.pos, state.pos + 14));
                if (!m) return false;
                if (!silent)
                  state.push("html_inline", "", 0).content = `<time data-date datetime="${m[1]}"></time>`;
                state.pos += m[0].length;
                return true;
              });
            });
          },
        },
      },
    };
  },
});

const insert =
  (offsetDays: number) => (e: Parameters<NonNullable<EditorPlugin["commands"]>[number]["run"]>[0]) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    e.chain()
      .focus()
      .insertContent([
        { type: "date", attrs: { date: isoOf(d) } },
        { type: "text", text: " " },
      ])
      .run();
  };

export const date: EditorPlugin = {
  name: "date",
  extensions: () => [DateNode],
  commands: [
    {
      id: "today",
      get title() {
        return t("Data di oggi");
      },
      get hint() {
        return t("Clic sulla data per cambiarla");
      },
      icon: "▦",
      get group() {
        return t("Meeting");
      },
      keywords: ["data", "oggi", "date", "today", "scadenza"],
      run: insert(0),
    },
    {
      id: "tomorrow",
      get title() {
        return t("Data di domani");
      },
      get hint() {
        return t("Clic sulla data per cambiarla");
      },
      icon: "▦",
      get group() {
        return t("Meeting");
      },
      keywords: ["data", "domani", "date", "tomorrow", "scadenza"],
      run: insert(1),
    },
  ],
};
