import { Node, mergeAttributes } from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import { h } from "../dom";
import { t } from "../../i18n";
import { once, type MdState } from "../markdown";
import type { EditorPlugin } from "../types";

const MAX = 5;
const clamp = (n: number) => Math.min(MAX, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
const stars = (value: number) => "★".repeat(value) + "☆".repeat(MAX - value);

/** Una valutazione da 1 a 5 stelle dentro il testo. In Markdown: `[[rating:4]]`. */
const Rating = Node.create({
  name: "rating",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      value: {
        default: 0,
        parseHTML: (el) => clamp(Number(el.getAttribute("data-rating"))),
        renderHTML: (attrs) => ({ "data-rating": String(attrs.value) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-rating]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "rating" }), stars(node.attrs.value)];
  },
  renderText({ node }) {
    return stars(node.attrs.value);
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h("span", {
        class: "rating",
        contentEditable: "false",
        attrs: { role: "radiogroup", "aria-label": t("Valutazione") },
      });
      const paint = (value: number) => {
        dom.title = t("{n} su 5", { n: value });
        dom.replaceChildren(
          ...Array.from({ length: MAX }, (_, i) =>
            h(
              "button",
              {
                type: "button",
                class: "rating-star" + (i < value ? " on" : ""),
                attrs: {
                  role: "radio",
                  "aria-checked": String(i + 1 === value),
                  "aria-label": t("{n} su 5", { n: i + 1 }),
                },
                on: {
                  mousedown: (e) => {
                    e.preventDefault();
                    if (!editor.isEditable) return;
                    const pos = typeof getPos === "function" ? getPos() : undefined;
                    if (typeof pos !== "number") return;
                    // un secondo clic sulla stessa stella azzera
                    const next = i + 1 === value ? 0 : i + 1;
                    editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { value: next }));
                  },
                },
              },
              i < value ? "★" : "☆",
            ),
          ),
        );
      };
      paint(node.attrs.value);
      return {
        dom,
        update(next) {
          if (next.type.name !== "rating") return false;
          paint(next.attrs.value);
          return true;
        },
        stopEvent: (e) => e.type === "mousedown" && dom.contains(e.target as globalThis.Node),
        ignoreMutation: () => true,
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: { attrs: { value: number } }) {
          state.write(`[[rating:${node.attrs.value}]]`);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "rating", () => {
              md.inline.ruler.before("link", "rating", (state, silent) => {
                const m = /^\[\[rating:(\d)\]\]/.exec(state.src.slice(state.pos, state.pos + 13));
                if (!m) return false;
                if (!silent)
                  state.push("html_inline", "", 0).content =
                    `<span data-rating="${clamp(Number(m[1]))}"></span>`;
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

export const rating: EditorPlugin = {
  name: "rating",
  extensions: () => [Rating],
  commands: [
    {
      id: "rating",
      get title() {
        return t("Valutazione");
      },
      get hint() {
        return t("Da 1 a 5 stelle");
      },
      icon: "★",
      get group() {
        return t("Strumenti");
      },
      keywords: ["valutazione", "stelle", "rating", "voto", "punteggio", "stars"],
      run: (e) =>
        e
          .chain()
          .focus()
          .insertContent([
            { type: "rating", attrs: { value: 3 } },
            { type: "text", text: " " },
          ])
          .run(),
    },
  ],
};
