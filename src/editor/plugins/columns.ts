import { Node, mergeAttributes } from "@tiptap/react";
import type { CommandProps, Editor } from "@tiptap/react";
import { NodeSelection, Selection, type EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { t } from "../../i18n";
import { cursorToStartOf, fence, once, useContainer, type MdState } from "../markdown";
import type { CommandItem, EditorPlugin } from "../types";
import { handles } from "../handles";

const MAX_COLUMNS = 3;

/** La colonna che contiene il cursore, con il blocco di colonne di cui fa parte. */
function where(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 1; depth--) {
    if ($from.node(depth).type.name !== "column") continue;
    return {
      column: $from.node(depth),
      columns: $from.node(depth - 1),
      index: $from.index(depth - 1),
      pos: $from.before(depth),
      blockPos: $from.before(depth - 1),
    };
  }
  return null;
}

/** Una colonna in cui non è stato scritto niente: un solo paragrafo vuoto. */
const isBlank = (column: PMNode) =>
  column.childCount === 1 && column.firstChild!.type.name === "paragraph" && !column.firstChild!.content.size;

type Op = "before" | "after" | "delColumn" | "unwrap" | "delBlock";

/**
 * Le operazioni sulle colonne, rispetto a quella con il cursore. Un blocco ha due o tre colonne:
 * togliendone una da due resta il testo dell'altra, come blocchi normali.
 */
const columnOp =
  (op: Op) =>
  ({ state, tr, dispatch }: CommandProps): boolean => {
    const at = where(state);
    if (!at) return false;
    const { column, columns, index, pos, blockPos } = at;
    const { paragraph } = state.schema.nodes;
    const blockEnd = blockPos + columns.nodeSize;
    const near = (p: number, bias: 1 | -1) => tr.setSelection(Selection.near(tr.doc.resolve(p), bias));
    switch (op) {
      case "before":
      case "after": {
        if (columns.childCount >= MAX_COLUMNS) return false;
        if (!dispatch) return true;
        const target = op === "before" ? pos : pos + column.nodeSize;
        tr.insert(target, column.type.create(null, paragraph.create()));
        near(target + 2, 1);
        return true;
      }
      case "delColumn": {
        if (!dispatch) return true;
        if (columns.childCount > 2) {
          tr.delete(pos, pos + column.nodeSize);
          near(pos, index > 0 ? -1 : 1);
          return true;
        }
        const other = columns.child(index === 0 ? 1 : 0);
        tr.replaceWith(blockPos, blockEnd, other.content);
        if (index === 0) near(blockPos, 1);
        else near(blockPos + other.content.size, -1);
        return true;
      }
      case "unwrap": {
        if (!dispatch) return true;
        const kept: PMNode[] = [];
        columns.forEach((c) => {
          if (!isBlank(c)) c.forEach((child) => kept.push(child));
        });
        tr.replaceWith(blockPos, blockEnd, kept.length ? kept : paragraph.create());
        near(blockPos, 1);
        return true;
      }
      case "delBlock": {
        if (!dispatch) return true;
        const $block = state.doc.resolve(blockPos);
        // dove il blocco è l'unico contenuto resta un paragrafo vuoto in cui scrivere
        if ($block.parent.canReplace($block.index(), $block.index() + 1)) tr.delete(blockPos, blockEnd);
        else tr.replaceWith(blockPos, blockEnd, paragraph.create());
        near(Math.min(blockPos, tr.doc.content.size), 1);
        return true;
      }
    }
  };

const run = (op: Op) => (e: Editor) => e.chain().focus().command(columnOp(op)).run();
const inColumns = (e: Editor) => e.isActive("columns");
const canAdd = (e: Editor) => (where(e.state)?.columns.childCount ?? MAX_COLUMNS) < MAX_COLUMNS;

// l'azione parte dalla colonna a cui la maniglia si riferisce, non da dove stava il cursore
const act = (editor: Editor, cell: HTMLElement, op: Op) => () => {
  const inside = Selection.near(editor.state.doc.resolve(editor.view.posAtDOM(cell, 0)), 1);
  editor.chain().focus().setTextSelection(inside.from).command(columnOp(op)).run();
};

/** Una maniglia per colonna, sul filo a sinistra, con le azioni sulla colonna e sul blocco. */
const columnHandles = (editor: Editor) =>
  handles({
    name: "columns",
    block: ".columns",
    cell: ".column",
    draw({ block, box, grip }) {
      const all = [...block.children].filter((el): el is HTMLElement => el.matches(".column"));
      return all.map((cell) => {
        const cb = box(cell);
        return grip({
          class: "handle-row",
          title: t("Colonna: aggiungi, elimina o togli le colonne"),
          at: { left: cb.left - 5, top: cb.top, width: 12, height: 22 },
          menu: () => [
            ...(all.length < MAX_COLUMNS
              ? [
                  { label: t("Aggiungi colonna a sinistra"), run: act(editor, cell, "before") },
                  { label: t("Aggiungi colonna a destra"), run: act(editor, cell, "after") },
                ]
              : []),
            { label: t("Elimina colonna"), danger: true, run: act(editor, cell, "delColumn") },
            "sep",
            { label: t("Togli le colonne, tieni il testo"), run: act(editor, cell, "unwrap") },
            { label: t("Elimina tutto il blocco"), danger: true, run: act(editor, cell, "delBlock") },
          ],
        });
      });
    },
  });

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
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || !$from.parent.isTextblock || $from.parentOffset > 0) return false;
        // all'inizio del blocco che segue le colonne: le seleziona (un altro Cancella le toglie),
        // invece di tirare quel blocco dentro una colonna in più
        const outer = $from.depth - 1;
        const before = $from.index(outer) > 0 ? $from.node(outer).child($from.index(outer) - 1) : null;
        if (before?.type.name === "columns") {
          const pos = $from.before() - before.nodeSize;
          view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).scrollIntoView());
          return true;
        }
        // in una colonna rimasta vuota: toglie la colonna, o tutto il blocco se sono vuote tutte
        const at = where(state);
        if (!at || !isBlank(at.column)) return false;
        let all = true;
        at.columns.forEach((c) => {
          if (!isBlank(c)) all = false;
        });
        return this.editor
          .chain()
          .command(columnOp(all ? "unwrap" : "delColumn"))
          .scrollIntoView()
          .run();
      },
    };
  },
  addProseMirrorPlugins() {
    return [columnHandles(this.editor)];
  },
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

/** I comandi delle colonne compaiono solo con il cursore dentro una colonna. */
const inside = (
  id: string,
  icon: string,
  title: () => string,
  op: Op,
  when: (e: Editor) => boolean = inColumns,
): CommandItem => ({
  id,
  get title() {
    return title();
  },
  icon,
  get group() {
    return t("Colonne");
  },
  keywords: ["colonne", "colonna", "columns", "column", "affiancati"],
  when,
  run: run(op),
});

export const columns: EditorPlugin = {
  name: "columns",
  extensions: () => [Column, Columns],
  commands: [
    inside("columns-add-before", "+", () => t("Aggiungi colonna a sinistra"), "before", canAdd),
    inside("columns-add-after", "+", () => t("Aggiungi colonna a destra"), "after", canAdd),
    inside("columns-col-del", "−", () => t("Elimina colonna"), "delColumn"),
    inside("columns-unwrap", "▤", () => t("Togli le colonne, tieni il testo"), "unwrap"),
    inside("columns-del", "✕", () => t("Elimina tutto il blocco"), "delBlock"),
    command(2, () => t("Due colonne")),
    command(3, () => t("Tre colonne")),
  ],
};
