import { InputRule } from "@tiptap/react";
import type { CommandProps, Editor } from "@tiptap/react";
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { TableMap } from "@tiptap/pm/tables";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { t } from "../../i18n";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { MdState } from "../markdown";
import type { CommandItem, EditorPlugin } from "../types";
import { handles, type MenuEntry } from "../handles";

/** La tabella che contiene il cursore, con la riga e la colonna della cella in cui si trova. */
function where(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth - 2; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name !== "table") continue;
    const start = $from.start(depth);
    const map = TableMap.get(node);
    const cell = map.findCell($from.before(depth + 2) - start);
    return { node, start, map, row: cell.top, col: cell.left };
  }
  return null;
}

/**
 * Porta il cursore in fondo al testo di una cella. `start` è l'inizio del contenuto della
 * tabella: resta valido anche quando, tolta una riga, il cursore è finito fuori dalla tabella.
 */
function cursorToCell(tr: Transaction, start: number, row: number, col: number): boolean {
  const table = tr.doc.resolve(start).parent;
  if (table.type.name !== "table") return false;
  const map = TableMap.get(table);
  const r = Math.min(Math.max(row, 0), map.height - 1);
  const c = Math.min(Math.max(col, 0), map.width - 1);
  const pos = start + map.map[r * map.width + c];
  const cell = tr.doc.nodeAt(pos);
  if (!cell) return false;
  tr.setSelection(Selection.near(tr.doc.resolve(pos + cell.nodeSize - 1), -1));
  return true;
}

type Op = "rowBefore" | "rowAfter" | "colBefore" | "colAfter" | "delRow" | "delCol" | "delTable" | "down";

/**
 * Le operazioni sulla tabella, rispetto alla cella con il cursore. Dopo un'aggiunta il cursore
 * va nella cella nuova; togliere l'ultima riga o l'ultima colonna toglie la tabella.
 */
const tableOp =
  (op: Op) =>
  ({ state, tr, commands }: CommandProps): boolean => {
    const at = where(state);
    if (!at) return false;
    const { row, col, map, start } = at;
    switch (op) {
      case "rowBefore":
        return commands.addRowBefore() && cursorToCell(tr, start, row, col);
      case "rowAfter":
        return commands.addRowAfter() && cursorToCell(tr, start, row + 1, col);
      case "colBefore":
        return commands.addColumnBefore() && cursorToCell(tr, start, row, col);
      case "colAfter":
        return commands.addColumnAfter() && cursorToCell(tr, start, row, col + 1);
      case "delRow":
        if (map.height === 1) return commands.deleteTable();
        return commands.deleteRow() && cursorToCell(tr, start, Math.min(row, map.height - 2), col);
      case "delCol":
        if (map.width === 1) return commands.deleteTable();
        return commands.deleteColumn() && cursorToCell(tr, start, row, Math.min(col, map.width - 2));
      case "delTable":
        return commands.deleteTable();
      case "down":
        if (row < map.height - 1) return cursorToCell(tr, start, row + 1, col);
        return commands.addRowAfter() && cursorToCell(tr, start, row + 1, col);
    }
  };

/** Una riga in cui nessuna cella ha del testo. */
function isEmptyRow(row: PMNode): boolean {
  let none = true;
  row.forEach((cell) => {
    if (cell.firstChild?.content.size) none = false;
  });
  return none;
}

const run = (op: Op) => (e: Editor) => e.chain().focus().command(tableOp(op)).run();

/**
 * In Markdown la prima riga è sempre l'intestazione: se ne viene tolta o aggiunta una in cima,
 * la nuova prima riga diventa intestazione e le altre righe normali, così quello che si vede è
 * quello che si rilegge.
 */
const headerRow = new Plugin({
  key: new PluginKey("tableHeaderRow"),
  appendTransaction(trs, _old, state) {
    if (!trs.some((tr) => tr.docChanged)) return null;
    const { tableHeader, tableCell } = state.schema.nodes;
    let fix: Transaction | null = null;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== "table") return true;
      node.forEach((row, rowOffset, i) => {
        const want = i === 0 ? tableHeader : tableCell;
        row.forEach((cell, cellOffset) => {
          if (cell.type !== want) {
            (fix ??= state.tr).setNodeMarkup(pos + 1 + rowOffset + 1 + cellOffset, want, cell.attrs);
          }
        });
      });
      return false;
    });
    return fix;
  },
});

/** Maniglie: una per la riga e una per la colonna della cella, più le barre "+" in fondo e a destra. */
const tableHandles = (editor: Editor) => {
  // l'azione parte dalla cella a cui la maniglia si riferisce, non da dove stava il cursore
  const act = (cell: HTMLElement, op: Op) => () => {
    const pos = editor.view.posAtDOM(cell, 0);
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .command(tableOp(op))
      .run();
  };
  const removeTable = (cell: HTMLElement): MenuEntry[] => [
    "sep",
    { label: t("Elimina tabella"), danger: true, run: act(cell, "delTable") },
  ];
  return handles({
    name: "table",
    block: "table",
    cell: "td, th",
    draw({ block, cell, box, grip, button }) {
      const table = block as HTMLTableElement;
      const last = table.rows[table.rows.length - 1];
      if (!last?.cells.length) return [];
      const tb = box(table);
      const out = [
        button({
          class: "handle-add",
          title: t("Aggiungi riga in fondo"),
          label: "+",
          at: { left: tb.left, top: tb.top + tb.height + 3, width: tb.width, height: 14 },
          run: act(last.cells[0], "rowAfter"),
        }),
        button({
          class: "handle-add",
          title: t("Aggiungi colonna in fondo"),
          label: "+",
          at: { left: tb.left + tb.width + 3, top: tb.top, width: 14, height: tb.height },
          run: act(table.rows[0].cells[table.rows[0].cells.length - 1], "colAfter"),
        }),
      ];
      if (!cell) return out;
      const cb = box(cell);
      out.push(
        grip({
          class: "handle-row",
          title: t("Riga: aggiungi o elimina"),
          at: { left: tb.left - 6, top: cb.top + cb.height / 2 - 11, width: 12, height: 22 },
          menu: () => [
            { label: t("Aggiungi riga sopra"), run: act(cell, "rowBefore") },
            { label: t("Aggiungi riga sotto"), run: act(cell, "rowAfter") },
            { label: t("Elimina riga"), danger: true, run: act(cell, "delRow") },
            ...removeTable(cell),
          ],
        }),
        grip({
          class: "handle-col",
          title: t("Colonna: aggiungi o elimina"),
          at: { left: cb.left + cb.width / 2 - 11, top: tb.top - 6, width: 22, height: 12 },
          menu: () => [
            { label: t("Aggiungi colonna a sinistra"), run: act(cell, "colBefore") },
            { label: t("Aggiungi colonna a destra"), run: act(cell, "colAfter") },
            { label: t("Elimina colonna"), danger: true, run: act(cell, "delCol") },
            ...removeTable(cell),
          ],
        }),
      );
      return out;
    },
  });
};

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
  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      // una cella è una riga di testo: Invio scende alla cella sotto, e in fondo aggiunge una riga
      Enter: () => {
        const { state } = this.editor;
        if (!state.selection.empty || !where(state)) return false;
        return this.editor.chain().command(tableOp("down")).scrollIntoView().run();
      },
      // Cancella in una riga tutta vuota la toglie; se è vuota tutta la tabella, toglie la tabella
      Backspace: (props) => {
        if (parent.Backspace?.(props)) return true;
        const { state } = this.editor;
        const at = state.selection.empty ? where(state) : null;
        if (!at || state.selection.$from.parent.content.size > 0) return false;
        if (!isEmptyRow(at.node.child(at.row))) return false;
        let all = true;
        at.node.forEach((row) => {
          if (!isEmptyRow(row)) all = false;
        });
        if (all) return this.editor.chain().command(tableOp("delTable")).run();
        // la riga di intestazione resta: toglierla promuoverebbe a intestazione una riga di dati
        if (at.row === 0) return false;
        return this.editor
          .chain()
          .deleteRow()
          .command(({ tr }) => cursorToCell(tr, at.start, at.row - 1, at.col))
          .run();
      },
    };
  },
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), headerRow, tableHandles(this.editor)];
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
              // un link, una persona o una data da soli non hanno testo, ma la cella non è vuota
              let filled = false;
              cellNode.firstChild?.forEach((c) => {
                if (!c.isText || c.text?.trim()) filled = true;
              });
              if (filled) state.renderInline(cellNode.firstChild!);
              const text = state.out
                .slice(from)
                .replace(/\\?\|/g, "\\|")
                .replace(/\s*\n\s*/g, " ");
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
const cell = (id: string, icon: string, title: () => string, action: (e: Editor) => void): CommandItem => ({
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
  run: action,
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
    cell("table-row-before", "+", () => t("Aggiungi riga sopra"), run("rowBefore")),
    cell("table-row-add", "+", () => t("Aggiungi riga sotto"), run("rowAfter")),
    cell("table-col-before", "+", () => t("Aggiungi colonna a sinistra"), run("colBefore")),
    cell("table-col-add", "+", () => t("Aggiungi colonna a destra"), run("colAfter")),
    cell("table-row-del", "−", () => t("Elimina riga"), run("delRow")),
    cell("table-col-del", "−", () => t("Elimina colonna"), run("delCol")),
    cell("table-del", "✕", () => t("Elimina tabella"), run("delTable")),
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
