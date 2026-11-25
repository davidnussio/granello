import { t } from "../../i18n";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { Node } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { MdState } from "../markdown";
import { trailingParagraph } from "../trailing";
import type { EditorPlugin } from "../types";

/**
 * Il nodo di testo, come quello di StarterKit ma con un Markdown che rispetta gli indirizzi
 * scritti `<https://…>`: lì dentro gli escape non valgono, quindi un `_` scritto `\_` diventerebbe
 * parte dell'indirizzo e a ogni salvataggio se ne aggiungerebbe un altro. Fuori, come tiptap-markdown:
 * escape del Markdown e `<` `>` scritti come entità.
 */
const Text = Node.create({
  name: "text",
  group: "inline",
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState & { inAutolink?: boolean }, node: PMNode) {
          const text = node.text ?? "";
          if (state.inAutolink) state.text(text, false);
          else state.text(text.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
        },
      },
    };
  },
});

/** Fondamenta: schema di base, cronologia, Markdown come formato di salvataggio, placeholder. */
export const base: EditorPlugin = {
  name: "base",
  extensions: ({ placeholder }) => [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, text: false }),
    Text,
    Placeholder.configure({ placeholder: placeholder ?? t("Scrivi le tue note…") }),
    Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true }),
    trailingParagraph,
  ],
};
