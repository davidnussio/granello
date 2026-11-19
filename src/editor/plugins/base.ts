import { t } from "../../i18n";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import type { EditorPlugin } from "../types";

/** Fondamenta: schema di base, cronologia, Markdown come formato di salvataggio, placeholder. */
export const base: EditorPlugin = {
  name: "base",
  extensions: ({ placeholder }) => [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Placeholder.configure({ placeholder: placeholder ?? t("Scrivi le tue note…") }),
    Markdown.configure({ html: false, tightLists: true, linkify: true, transformPastedText: true }),
  ],
};
