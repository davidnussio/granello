import { InputRule } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { t } from "../../i18n";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { MdState } from "../markdown";
import type { CommandItem, EditorPlugin } from "../types";

const insert = (e: Editor) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

/**
 * Tabella salvata come tabella Markdown: per questo ha sempre una riga di intestazione e
 * ogni cella contiene una sola riga di testo (ciò che il Markdown sa rappresentare).
 */
const NoteTable = Table.extend({
  addInputRules() {
    return [
      // "| " a inizio riga apre una tabella
      new InputRule({
        find: /^\|\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        },
      }),
    ];
  },
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        // la prima riga è l'intestazione; in una cella "|" e gli a capo romperebbero la riga
        serialize(state: MdState & { out: string }, node: PMNode) {
          node.forEach((row, _offset, i) => {
            state.write("| ");
            row.forEach((cellNode, _o, j) => {
              if (j) state.write(" | ");
              const from = state.out.length;
              if (cellNode.firstChild?.textContent.trim()) state.renderInline(cellNode.firstChild);
              const text = state.out.slice(from).replace(/\\?\|/g, "\\|").replace(/\s*\n\s*/g, " ");
              state.out = state.out.slice(0, from) + text;
            });
            state.write(" |");
            state.ensureNewLine();
            if (i === 0) {
              state.write(`| ${Array.from({ length: row.childCount }, () => "---").join(" | ")} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
        },
      },
    };
  },
}).configure({ resizable: false, HTMLAttributes: { class: "note-table" } });

const inTable = (e: Editor) => e.isActive("table");

/** I comandi della tabella compaiono solo con il cursore dentro una tabella. */
const cell = (id: string, icon: string, title: () => string, run: (e: Editor) => void): CommandItem => ({
  id,
  get title() {
    return title();
  },
  icon,
  get group() {
    return t("Tabella");
  },
  keywords: ["tabella", "table", "riga", "colonna", "row", "column"],
  when: inTable,
  run,
});

export const table: EditorPlugin = {
  name: "table",
  extensions: () => [
    NoteTable,
    TableRow,
    TableHeader.extend({ content: "paragraph" }),
    TableCell.extend({ content: "paragraph" }),
  ],
  commands: [
    cell("table-row-add", "+", () => t("Aggiungi riga sotto"), (e) => e.chain().focus().addRowAfter().run()),
    cell("table-col-add", "+", () => t("Aggiungi colonna a destra"), (e) => e.chain().focus().addColumnAfter().run()),
    cell("table-row-del", "−", () => t("Elimina riga"), (e) => e.chain().focus().deleteRow().run()),
    cell("table-col-del", "−", () => t("Elimina colonna"), (e) => e.chain().focus().deleteColumn().run()),
    cell("table-del", "✕", () => t("Elimina tabella"), (e) => e.chain().focus().deleteTable().run()),
    {
      id: "table",
      get title() {
        return t("Tabella");
      },
      get hint() {
        return t("| + spazio");
      },
      icon: "▤",
      get group() {
        return t("Blocchi");
      },
      keywords: ["tabella", "table", "griglia", "righe", "colonne"],
      when: (e) => !inTable(e),
      run: insert,
    },
  ],
};
