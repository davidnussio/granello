import { t } from "../../i18n";
import type { CommandItem, EditorPlugin, ToolbarItem } from "../types";

type Level = 1 | 2 | 3;
const NAMES: Record<Level, string> = { 1: "Titolo", 2: "Sezione", 3: "Sottosezione" };

const command = (level: Level): CommandItem => ({
  id: `h${level}`,
  get title() {
    return t(NAMES[level]);
  },
  get hint() {
    return t("{marks} + spazio", { marks: "#".repeat(level) });
  },
  icon: `H${level}`,
  get group() {
    return t("Struttura");
  },
  keywords: ["titolo", "heading", "intestazione", `h${level}`],
  run: (e) => e.chain().focus().setHeading({ level }).run(),
});

const button = (level: Level): ToolbarItem => ({
  id: `h${level}`,
  group: "block",
  label: `H${level}`,
  get title() {
    return t(NAMES[level]);
  },
  isActive: (e) => e.isActive("heading", { level }),
  run: (e) => e.chain().focus().toggleHeading({ level }).run(),
});

export const headings: EditorPlugin = {
  name: "headings",
  commands: [
    {
      id: "paragraph",
      get title() {
        return t("Testo");
      },
      get hint() {
        return t("Paragrafo normale");
      },
      icon: "¶",
      get group() {
        return t("Struttura");
      },
      keywords: ["paragrafo", "normale", "text"],
      run: (e) => e.chain().focus().setParagraph().run(),
    },
    command(1),
    command(2),
    command(3),
  ],
  toolbar: [button(2), button(3)],
};
