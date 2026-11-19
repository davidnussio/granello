import type { EditorPlugin } from "../types";

export const lists: EditorPlugin = {
  name: "lists",
  commands: [
    {
      id: "bullet-list",
      title: "Elenco puntato",
      hint: "- + spazio",
      icon: "•",
      group: "Elenchi",
      keywords: ["lista", "bullet", "punti"],
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      id: "ordered-list",
      title: "Elenco numerato",
      hint: "1. + spazio",
      icon: "1.",
      group: "Elenchi",
      keywords: ["lista", "numeri", "ordered"],
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
  ],
  toolbar: [
    {
      id: "bullet-list",
      group: "block",
      label: "•",
      title: "Elenco puntato (⌘⇧8)",
      isActive: (e) => e.isActive("bulletList"),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
  ],
};
