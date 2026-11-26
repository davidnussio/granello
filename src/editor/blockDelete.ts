import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { handles } from "./handles";
import { t } from "../i18n";

/** Blocchi di testo: si cancellano scrivendo, non hanno bisogno della ✕. */
const TEXT = new Set(["paragraph", "heading", "bulletList", "orderedList", "taskList", "blockquote"]);

const SIZE = 22;

/**
 * Una ✕ nel margine destro, all'altezza del bordo in alto del blocco sotto il puntatore (o di
 * quello col cursore): elimina il blocco intero, ⌘Z lo riporta. Vale per ogni blocco che non è
 * solo testo (citazioni, momenti, AI, tabelle, indice, callout, codice…). Sta fuori dal blocco,
 * così non copre mai i suoi pulsanti.
 */
const deleteHandle = (editor: Editor) =>
  handles({
    name: "block-delete",
    block: ".ProseMirror > *",
    // nessuna cella: si agisce sempre sul blocco intero
    cell: ":not(*)",
    draw({ block, box, button }) {
      const { view, state } = editor;
      let pos = -1;
      let type = "";
      state.doc.forEach((node, at) => {
        if (pos < 0 && !TEXT.has(node.type.name) && view.nodeDOM(at) === block) {
          pos = at;
          type = node.type.name;
        }
      });
      if (pos < 0) return [];
      const b = box(block);
      // a destra della tabella c'è la barra "+" delle colonne (14px): la ✕ le sta accanto.
      // Mai sopra il blocco: per arrivarci si passerebbe sul blocco precedente, e sparirebbe.
      const gap = type === "table" ? 21 : 4;
      return [
        button({
          class: "handle-del",
          title: t("Elimina il blocco (⌘Z per riaverlo)"),
          label: "✕",
          at: { left: b.left + b.width + gap, top: b.top, width: SIZE, height: SIZE },
          run: () => editor.chain().focus().setNodeSelection(pos).deleteSelection().run(),
        }),
      ];
    },
  });

export const blockDelete = Extension.create({
  name: "blockDelete",
  addProseMirrorPlugins() {
    return [deleteHandle(this.editor)];
  },
});
