import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { Node as PMNode } from "@tiptap/pm/model";
import containerPlugin from "markdown-it-container";
import type { Editor } from "@tiptap/react";
import { Selection, type Transaction } from "@tiptap/pm/state";

/**
 * Le note si salvano in Markdown. Ogni componente dell'editor dichiara come si scrive
 * (`serialize`) e come si rilegge (`parse.setup`, una regola di markdown-it che produce
 * l'HTML riconosciuto dal suo `parseHTML`). Qui stanno i pezzi comuni.
 */

/** La parte dello stato del serializzatore (prosemirror-markdown) che usiamo. */
export interface MdState {
  write(text?: string): void;
  text(text: string, escape?: boolean): void;
  ensureNewLine(): void;
  closeBlock(node: PMNode): void;
  renderContent(node: PMNode): void;
  renderInline(node: PMNode): void;
  render(node: PMNode, parent: PMNode, index: number): void;
  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void;
}

/** `parse.setup` viene chiamato a ogni lettura: ogni regola va registrata una volta sola. */
export function once(md: MarkdownIt, key: string, setup: () => void) {
  const holder = md as unknown as { granelloRules?: Set<string> };
  const done = (holder.granelloRules ??= new Set());
  if (done.has(key)) return;
  done.add(key);
  setup();
}

export function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sostituisce con un blocco HTML i paragrafi che `match` riconosce (ritorna l'HTML, o null
 * per lasciarli stare). Serve ai blocchi che in Markdown sono una riga a sé, come `[[toc]]`.
 */
export function replaceParagraphs(md: MarkdownIt, name: string, match: (inline: Token) => string | null) {
  md.core.ruler.push(name, (state) => {
    const tokens = state.tokens;
    for (let i = tokens.length - 3; i >= 0; i--) {
      if (tokens[i].type !== "paragraph_open" || tokens[i + 1].type !== "inline") continue;
      const html = match(tokens[i + 1]);
      if (html == null) continue;
      const block = new state.Token("html_block", "", 0);
      block.content = html;
      block.block = true;
      tokens.splice(i, 3, block);
    }
  });
}

/**
 * Porta il fuoco su un campo dentro un blocco appena inserito. Va fatto dopo che l'editor ha
 * ripreso il suo (lo fa al fotogramma successivo al comando), altrimenti se lo riprende lui.
 */
export function focusSoon(run: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/**
 * Passo di una catena di comandi: dopo aver inserito un blocco che ne contiene altri, porta
 * il cursore all'inizio del blocco di quel tipo (l'inserimento lo lascerebbe in fondo).
 */
export function cursorToStartOf(type: string) {
  return ({ tr }: { tr: Transaction }) => {
    const $from = tr.selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === type) {
        tr.setSelection(Selection.near(tr.doc.resolve($from.start(depth) + 1)));
        break;
      }
    }
    return true;
  };
}

/** Da un campo dentro un blocco si torna a scrivere nella nota, subito dopo la posizione data. */
export function backToEditor(editor: Editor, pos: number) {
  const { state, view } = editor;
  const at = Math.min(Math.max(pos, 0), state.doc.content.size);
  view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(at))));
  view.focus();
}

/** I blocchi scritti come contenitore `::: nome`. Chi ne definisce uno nuovo si aggiunge qui. */
export const CONTAINERS = new Set(["toggle", "columns", "column"]);

/**
 * La riga di apertura e chiusura di un contenitore. Uno che ne contiene altri usa più due
 * punti di quelli dentro, altrimenti la prima chiusura interna chiuderebbe anche lui.
 */
export function fence(node: PMNode): string {
  const depth = (n: PMNode): number => {
    let max = 0;
    n.forEach((child) => {
      const inner = depth(child);
      max = Math.max(max, CONTAINERS.has(child.type.name) ? inner + 1 : inner);
    });
    return max;
  };
  return ":".repeat(3 + depth(node));
}

/**
 * Registra un contenitore `::: nome` … `:::`. `open` riceve il testo dopo il nome (es. il titolo
 * di una sezione richiudibile) e ritorna l'HTML di apertura; la chiusura è sempre `</div>`.
 */
export function useContainer(md: MarkdownIt, name: string, open: (info: string) => string) {
  // i tipi del plugin e quelli di markdown-it arrivano da due build diverse dello stesso pacchetto
  md.use(containerPlugin as unknown as Parameters<MarkdownIt["use"]>[0], name, {
    render: (tokens: Token[], idx: number) =>
      tokens[idx].nesting === 1 ? open(tokens[idx].info.trim().slice(name.length).trim()) : "</div>",
  });
}

/**
 * Registra un contenitore `::: nome` il cui contenuto non è Markdown ma dati del blocco
 * (le opzioni di un sondaggio, le schede di una lavagna…): `toHtml` riceve il testo dopo il
 * nome e le righe fino alla chiusura.
 */
export function rawContainer(md: MarkdownIt, name: string, toHtml: (info: string, lines: string[]) => string) {
  md.block.ruler.before(
    "fence",
    `raw_${name}`,
    (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const line = (n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
      const open = /^(:{3,})\s*([\w-]+)\s*(.*)$/.exec(line(startLine));
      if (!open || open[2] !== name) return false;
      const lines: string[] = [];
      let end = startLine + 1;
      for (; end < endLine; end++) {
        const l = line(end);
        const close = /^(:{3,})\s*$/.exec(l);
        if (close && close[1].length >= open[1].length) break;
        lines.push(l);
      }
      if (end >= endLine) return false; // mai chiuso: resta testo
      if (silent) return true;
      const token = state.push("html_block", "", 0);
      token.content = toHtml(open[3].trim(), lines);
      token.map = [startLine, end + 1];
      state.line = end + 1;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
}
