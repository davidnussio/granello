import { Mark } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import { t } from "../../i18n";
import { once } from "../markdown";
import type { EditorPlugin } from "../types";

const COLORS = ["yellow", "green", "blue", "pink"] as const;
type Color = (typeof COLORS)[number];
const isColor = (c: string | null | undefined): c is Color => COLORS.includes(c as Color);

/** In Markdown: `==testo==` (giallo) oppure `==testo=={.green}` per gli altri colori. */
const Highlight = Mark.create({
  name: "highlight",
  addAttributes() {
    return {
      color: {
        default: "yellow",
        parseHTML: (el) => (isColor(el.getAttribute("data-color")) ? el.getAttribute("data-color") : "yellow"),
        renderHTML: (attrs) => ({ "data-color": attrs.color }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", HTMLAttributes, 0];
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name, { color: "yellow" }) };
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: "==",
          close: (_state: unknown, mark: { attrs: { color: string } }) =>
            mark.attrs.color === "yellow" ? "==" : `=={.${mark.attrs.color}}`,
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "highlight", () => {
              md.inline.ruler.before("emphasis", "highlight", (state, silent) => {
                const start = state.pos;
                if (state.src.charCodeAt(start) !== 0x3d || state.src.charCodeAt(start + 1) !== 0x3d) return false;
                const end = state.src.indexOf("==", start + 2);
                if (end < 0 || end + 2 > state.posMax) return false;
                const inner = state.src.slice(start + 2, end);
                // "a == b == c" non è un'evidenziazione
                if (!inner || /^\s|\s$/.test(inner)) return false;
                let after = end + 2;
                let color: string = "yellow";
                const suffix = /^\{\.([a-z]+)\}/.exec(state.src.slice(after, after + 12));
                if (suffix && isColor(suffix[1])) {
                  color = suffix[1];
                  after += suffix[0].length;
                }
                if (!silent) {
                  state.push("mark_open", "mark", 1).attrSet("data-color", color);
                  const max = state.posMax;
                  state.pos = start + 2;
                  state.posMax = end;
                  state.md.inline.tokenize(state);
                  state.posMax = max;
                  state.push("mark_close", "mark", -1);
                }
                state.pos = after;
                return true;
              });
            });
          },
        },
      },
    };
  },
});

function HighlightPanel({ editor, close }: { editor: Editor; close: () => void }) {
  const label: Record<Color, string> = {
    yellow: t("Giallo"),
    green: t("Verde"),
    blue: t("Azzurro"),
    pink: t("Rosa"),
  };
  return (
    <div className="tb-panel">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="tb-btn"
          title={label[color]}
          aria-label={label[color]}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().setMark("highlight", { color }).run();
            close();
          }}
        >
          <span className="hl-dot" data-color={color} />
        </button>
      ))}
      {editor.isActive("highlight") && (
        <button
          type="button"
          className="tb-btn"
          title={t("Togli l'evidenziazione")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().unsetMark("highlight").run();
            close();
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export const highlight: EditorPlugin = {
  name: "highlight",
  extensions: () => [Highlight],
  toolbar: [
    {
      id: "highlight",
      group: "inline",
      label: "A",
      className: "tb-highlight",
      get title() {
        return t("Evidenzia (⌘⇧H)");
      },
      isActive: (e) => e.isActive("highlight"),
      panel: HighlightPanel,
    },
  ],
};
