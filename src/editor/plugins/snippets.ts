import type { EditorPlugin } from "../types";

const dateFmt = new Intl.DateTimeFormat("it-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("it-CH", { hour: "2-digit", minute: "2-digit" });

/** Frammenti tipici delle note di un meeting. Esempio di plugin senza estensioni TipTap. */
export const snippets: EditorPlugin = {
  name: "snippets",
  commands: [
    {
      id: "decision",
      title: "Decisione",
      hint: "Evidenzia una decisione presa",
      icon: "✓",
      group: "Meeting",
      keywords: ["decisione", "deciso", "decision"],
      run: (e) => e.chain().focus().insertContent("**Decisione:** ").run(),
    },
    {
      id: "question",
      title: "Domanda aperta",
      hint: "Qualcosa da chiarire dopo",
      icon: "?",
      group: "Meeting",
      keywords: ["domanda", "dubbio", "question", "aperta"],
      run: (e) => e.chain().focus().insertContent("**Da chiarire:** ").run(),
    },
    {
      id: "now",
      title: "Ora attuale",
      hint: "Inserisce l'orario",
      icon: "◷",
      group: "Meeting",
      keywords: ["ora", "orario", "time", "adesso"],
      run: (e) => e.chain().focus().insertContent(`${timeFmt.format(new Date())} `).run(),
    },
    {
      id: "today",
      title: "Data di oggi",
      hint: "Inserisce la data",
      icon: "▦",
      group: "Meeting",
      keywords: ["data", "oggi", "date", "today"],
      run: (e) => e.chain().focus().insertContent(`${dateFmt.format(new Date())} `).run(),
    },
  ],
};
