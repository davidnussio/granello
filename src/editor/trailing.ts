import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** Blocchi dopo i quali, a fine nota, non ci sarebbe un punto dove continuare a scrivere. */
export const NEEDS_PARAGRAPH_AFTER = new Set(["table", "columns", "toggle", "callout", "mathBlock", "toc", "linkCard", "image"]);

/** Tiene sempre un paragrafo in fondo quando la nota finisce con uno di quei blocchi. */
export const trailingParagraph = Extension.create({
  name: "trailingParagraph",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("trailingParagraph"),
        appendTransaction: (_trs, _old, state) => {
          const last = state.doc.lastChild;
          if (!last || !NEEDS_PARAGRAPH_AFTER.has(last.type.name)) return null;
          const tr = state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
          return tr.setMeta("addToHistory", false);
        },
      }),
    ];
  },
});
