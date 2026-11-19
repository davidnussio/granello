import { Node, mergeAttributes } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { t } from "../../i18n";
import { cursorToStartOf, fence, once, useContainer, type MdState } from "../markdown";
import type { CommandItem, EditorPlugin } from "../types";

const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "column" }), 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          const marker = fence(node);
          state.write(`${marker} column`);
          state.ensureNewLine();
          state.renderContent(node);
          state.write(marker);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "column", () => {
              useContainer(md, "column", () => "<div data-column>");
            });
          },
        },
      },
    };
  },
});

/** Blocchi affiancati. In Markdown: `:::: columns` che contiene un `::: column` per colonna. */
const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "", class: "columns" }), 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          const marker = fence(node);
          state.write(`${marker} columns`);
          state.ensureNewLine();
          node.forEach((child, _offset, i) => state.render(child, node, i));
          state.write(marker);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "columns", () => {
              useContainer(md, "columns", () => "<div data-columns>");
            });
          },
        },
      },
    };
  },
});

const insert = (count: number) => (e: Editor) =>
  e
    .chain()
    .focus()
    .insertContent({
      type: "columns",
      content: Array.from({ length: count }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
    })
    .command(cursorToStartOf("columns"))
    .run();

const command = (count: 2 | 3, title: () => string): CommandItem => ({
  id: `columns-${count}`,
  get title() {
    return title();
  },
  get hint() {
    return t("Blocchi affiancati");
  },
  icon: count === 2 ? "▥" : "▦",
  get group() {
    return t("Blocchi");
  },
  keywords: ["colonne", "columns", "affiancati", "layout", String(count)],
  // niente colonne dentro colonne
  when: (e) => !e.isActive("columns"),
  run: insert(count),
});

export const columns: EditorPlugin = {
  name: "columns",
  extensions: () => [Column, Columns],
  commands: [command(2, () => t("Due colonne")), command(3, () => t("Tre colonne"))],
};
