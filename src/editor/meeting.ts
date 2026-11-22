import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Ciò che serve ai blocchi legati alla trascrizione (momento segnato, citazione). */

/** Evento per la pagina del meeting: mostra la trascrizione a quel punto. `detail`: i millisecondi. */
export const SHOW_IN_TRANSCRIPT = "granello:show-moment";

export function showInTranscript(ms: number) {
  window.dispatchEvent(new CustomEvent<number>(SHOW_IN_TRANSCRIPT, { detail: ms }));
}

/**
 * Evento per la pagina del meeting: il comando "/" chiede una citazione. `detail`: l'editor.
 * La pagina lo annulla (`preventDefault`) e inserisce lei la citazione con il minuto della
 * registrazione; dove nessuno lo annulla (i modelli) il comando la inserisce a 0:00.
 */
export const QUOTE_FROM_SLASH = "granello:quote-from-slash";

/** "12:34" oppure "1:02:03" in millisecondi. */
export function parseTime(text: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** I blocchi che si aggiungono così: momento segnato e citazione. */
const ASIDES = new Set(["moment", "transcriptQuote"]);

/**
 * Mette un blocco nella nota senza spostare il cursore: chi lo aggiunge sta ascoltando o
 * scrivendo, e deve poter continuare. Va dopo il blocco in cui si sta scrivendo (prima, se è
 * una riga vuota), oppure in fondo alla nota.
 */
export function insertAside(editor: Editor, node: PMNode) {
  const { state } = editor;
  const { $from } = state.selection;
  let pos = state.doc.content.size;
  // la riga vuota che chiude la nota resta in fondo
  const last = state.doc.lastChild;
  if (last && last.type.name === "paragraph" && last.content.size === 0) pos -= last.nodeSize;
  // senza il cursore nell'editor vale l'ultimo punto in cui si è scritto; se non si è mai
  // scritto (la selezione è ancora all'inizio) il blocco va in fondo
  if ((editor.isFocused || $from.pos > 1) && $from.depth > 0) {
    const block = $from.node(1);
    const emptyLine = block.type.name === "paragraph" && block.content.size === 0;
    pos = emptyLine ? $from.before(1) : $from.after(1);
  }
  // più blocchi aggiunti di fila dallo stesso punto restano nell'ordine in cui sono arrivati
  for (let next = state.doc.nodeAt(pos); next && ASIDES.has(next.type.name); next = state.doc.nodeAt(pos)) {
    pos += next.nodeSize;
  }
  editor.view.dispatch(state.tr.insert(pos, node));
}
