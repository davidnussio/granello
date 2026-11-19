import type { Node as PMNode } from "@tiptap/pm/model";
import { dataBlock, type BlockView } from "../dataBlock";
import { h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

type Nothing = Record<string, never>;

/**
 * Le azioni della sezione in cui sta il blocco: dal titolo che lo precede fino al prossimo
 * titolo dello stesso livello o superiore. Senza un titolo prima, tutta la nota.
 */
export function sectionTasks(doc: PMNode, pos: number): { done: number; total: number } {
  let from = 0;
  let to = doc.content.size;
  let level = 0;
  doc.forEach((node, offset) => {
    if (node.type.name !== "heading") return;
    if (offset < pos) {
      from = offset;
      level = node.attrs.level;
      to = doc.content.size;
    } else if (level && to === doc.content.size && node.attrs.level <= level) {
      to = offset;
    }
  });
  let done = 0;
  let total = 0;
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "taskItem") {
      total++;
      if (node.attrs.checked) done++;
    }
  });
  return { done, total };
}

function render(view: BlockView<Nothing>) {
  if (!view.local.subscribed) {
    view.local.subscribed = true;
    const refresh = () => render(view);
    view.editor.on("update", refresh);
    view.cleanup.push(() => view.editor.off("update", refresh));
  }
  const pos = view.pos();
  const { done, total } = pos === null ? { done: 0, total: 0 } : sectionTasks(view.editor.state.doc, pos);
  const signature = `${done}/${total}`;
  if (view.local.shown === signature) return;
  view.local.shown = signature;

  const share = total ? Math.round((done / total) * 100) : 0;
  view.dom.classList.toggle("complete", total > 0 && done === total);
  view.dom.replaceChildren(
    h("span", { class: "progress-bar" }, h("span", { style: `width: ${share}%` })),
    h(
      "span",
      { class: "progress-label" },
      total ? t("{done} di {total} · {pct}%", { done, total, pct: share }) : t("Nessuna azione in questa sezione"),
    ),
  );
}

/**
 * Avanzamento delle azioni della sezione, calcolato dalle caselle spuntate. In Markdown è la
 * riga `[[progress]]`: non salva numeri, li ricava ogni volta dalla nota.
 */
const ProgressBlock = dataBlock<Nothing>({
  name: "progress",
  tag: "progress",
  empty: {},
  format: {
    kind: "line",
    match: /^\[\[progress\]\]$/i,
    parse: () => ({}),
    write: () => "[[progress]]",
  },
  render,
});

export const progress: EditorPlugin = {
  name: "progress",
  extensions: () => [ProgressBlock],
  commands: [
    {
      id: "progress",
      get title() {
        return t("Avanzamento");
      },
      get hint() {
        return t("Quante azioni della sezione sono fatte");
      },
      icon: "◐",
      get group() {
        return t("Strumenti");
      },
      keywords: ["avanzamento", "progress", "percentuale", "barra", "completamento", "stato"],
      run: (e) => e.chain().focus().insertContent({ type: "progress" }).run(),
    },
  ],
};
