import type { EditorPlugin } from "../types";

export const blocks: EditorPlugin = {
  name: "blocks",
  commands: [
    {
      id: "quote",
      title: "Citazione",
      hint: "> + spazio",
      icon: "❝",
      group: "Blocchi",
      keywords: ["quote", "blockquote", "citazione"],
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      id: "code-block",
      title: "Blocco di codice",
      hint: "``` + spazio",
      icon: "</>",
      group: "Blocchi",
      keywords: ["code", "codice", "snippet"],
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: "divider",
      title: "Separatore",
      hint: "--- + invio",
      icon: "—",
      group: "Blocchi",
      keywords: ["linea", "divider", "hr", "separatore"],
      run: (e) => e.chain().focus().setHorizontalRule().run(),
    },
  ],
};
