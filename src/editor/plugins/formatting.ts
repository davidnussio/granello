import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

export const formatting: EditorPlugin = {
  name: "formatting",
  toolbar: [
    {
      id: "bold",
      group: "inline",
      label: "B",
      className: "tb-bold",
      get title() {
        return t("Grassetto (⌘B)");
      },
      isActive: (e) => e.isActive("bold"),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      id: "italic",
      group: "inline",
      label: "I",
      className: "tb-italic",
      get title() {
        return t("Corsivo (⌘I)");
      },
      isActive: (e) => e.isActive("italic"),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      id: "strike",
      group: "inline",
      label: "S",
      className: "tb-strike",
      get title() {
        return t("Barrato (⌘⇧S)");
      },
      isActive: (e) => e.isActive("strike"),
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      id: "code",
      group: "inline",
      label: "</>",
      className: "tb-code",
      get title() {
        return t("Codice (⌘E)");
      },
      isActive: (e) => e.isActive("code"),
      run: (e) => e.chain().focus().toggleCode().run(),
    },
  ],
};
