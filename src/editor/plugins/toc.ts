import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { t } from "../../i18n";
import { once, replaceParagraphs, type MdState } from "../markdown";
import type { EditorPlugin } from "../types";

/** Sommario dei titoli della nota, sempre aggiornato. In Markdown è la riga `[[toc]]`. */
const Toc = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })];
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement("nav");
      dom.className = "toc";
      dom.contentEditable = "false";
      dom.setAttribute("aria-label", t("Indice"));
      let signature = "";

      const rebuild = () => {
        const headings: { level: number; text: string; pos: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "heading" && node.textContent.trim()) {
            headings.push({ level: node.attrs.level, text: node.textContent, pos });
          }
        });
        const next = JSON.stringify(headings);
        if (next === signature) return;
        signature = next;
        if (headings.length === 0) {
          const empty = document.createElement("span");
          empty.className = "toc-empty";
          empty.textContent = t("Indice: la nota non ha ancora titoli.");
          dom.replaceChildren(empty);
          return;
        }
        const top = Math.min(...headings.map((h) => h.level));
        dom.replaceChildren(
          ...headings.map((h) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "toc-item";
            item.style.paddingLeft = `${(h.level - top) * 16}px`;
            item.textContent = h.text;
            item.addEventListener("mousedown", (e) => {
              e.preventDefault();
              editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run();
            });
            return item;
          }),
        );
      };
      rebuild();
      editor.on("update", rebuild);

      return {
        dom,
        ignoreMutation: () => true,
        destroy: () => editor.off("update", rebuild),
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          state.write("[[toc]]");
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "toc", () => {
              replaceParagraphs(md, "toc", (inline) =>
                inline.content.trim().toLowerCase() === "[[toc]]" ? "<div data-toc></div>" : null,
              );
            });
          },
        },
      },
    };
  },
});

export const toc: EditorPlugin = {
  name: "toc",
  extensions: () => [Toc],
  commands: [
    {
      id: "toc",
      get title() {
        return t("Indice");
      },
      get hint() {
        return t("Sommario dei titoli della nota");
      },
      icon: "≡",
      get group() {
        return t("Struttura");
      },
      keywords: ["indice", "sommario", "toc", "contents", "outline"],
      run: (e) => e.chain().focus().insertContent({ type: "toc" }).run(),
    },
  ],
};
