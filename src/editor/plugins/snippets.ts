import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

const dateFmt = new Intl.DateTimeFormat("it-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("it-CH", { hour: "2-digit", minute: "2-digit" });

/** Frammenti tipici delle note di un meeting. Esempio di plugin senza estensioni TipTap. */
export const snippets: EditorPlugin = {
  name: "snippets",
  commands: [
    {
      id: "decision",
      get title() {
        return t("Decisione");
      },
      get hint() {
        return t("Evidenzia una decisione presa");
      },
      icon: "✓",
      get group() {
        return t("Meeting");
      },
      keywords: ["decisione", "deciso", "decision"],
      run: (e) => e.chain().focus().insertContent(t("**Decisione:** ")).run(),
    },
    {
      id: "question",
      get title() {
        return t("Domanda aperta");
      },
      get hint() {
        return t("Qualcosa da chiarire dopo");
      },
      icon: "?",
      get group() {
        return t("Meeting");
      },
      keywords: ["domanda", "dubbio", "question", "aperta"],
      run: (e) => e.chain().focus().insertContent(t("**Da chiarire:** ")).run(),
    },
    {
      id: "now",
      get title() {
        return t("Ora attuale");
      },
      get hint() {
        return t("Inserisce l'orario");
      },
      icon: "◷",
      get group() {
        return t("Meeting");
      },
      keywords: ["ora", "orario", "time", "adesso"],
      run: (e) => e.chain().focus().insertContent(`${timeFmt.format(new Date())} `).run(),
    },
    {
      id: "today",
      get title() {
        return t("Data di oggi");
      },
      get hint() {
        return t("Inserisce la data");
      },
      icon: "▦",
      get group() {
        return t("Meeting");
      },
      keywords: ["data", "oggi", "date", "today"],
      run: (e) => e.chain().focus().insertContent(`${dateFmt.format(new Date())} `).run(),
    },
  ],
};
