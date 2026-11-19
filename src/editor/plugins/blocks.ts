import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

export const blocks: EditorPlugin = {
  name: "blocks",
  commands: [
    {
      id: "quote",
      get title() {
        return t("Citazione");
      },
      get hint() {
        return t("> + spazio");
      },
      icon: "❝",
      get group() {
        return t("Blocchi");
      },
      keywords: ["quote", "blockquote", "citazione"],
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code-block",
      get title() {
        return t("Blocco di codice");
      },
      get hint() {
        return t("``` + spazio");
      },
      icon: "</>",
      get group() {
        return t("Blocchi");
      },
      keywords: ["code", "codice", "snippet"],
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "divider",
      get title() {
        return t("Separatore");
      },
      get hint() {
        return t("--- + invio");
      },
      icon: "—",
      get group() {
        return t("Blocchi");
      },
      keywords: ["linea", "divider", "hr", "separatore"],
      run: (e) => e.chain().focus().setHorizontalRule().run(),
    },
  ],
};
