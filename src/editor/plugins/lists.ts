import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

export const lists: EditorPlugin = {
  name: "lists",
  commands: [
    {
      id: "bullet-list",
      get title() {
        return t("Elenco puntato");
      },
      get hint() {
        return t("- + spazio");
      },
      icon: "•",
      get group() {
        return t("Elenchi");
      },
      keywords: ["lista", "bullet", "punti"],
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      get title() {
        return t("Elenco numerato");
      },
      get hint() {
        return t("1. + spazio");
      },
      icon: "1.",
      get group() {
        return t("Elenchi");
      },
      keywords: ["lista", "numeri", "ordered"],
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
  ],
  toolbar: [
    {
      id: "bullet-list",
      group: "block",
      label: "•",
      get title() {
        return t("Elenco puntato (⌘⇧8)");
      },
      isActive: (e) => e.isActive("bulletList"),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
  ],
};
