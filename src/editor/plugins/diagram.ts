import { dataBlock, type BlockView } from "../dataBlock";
import { h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Diagram {
  code: string;
}

/** Il diagramma d'esempio che inserisce il comando, nella lingua dell'interfaccia. */
const sample = () =>
  `flowchart LR\n  A[${t("Richiesta")}] --> B{${t("Approvata?")}}\n  B -- ${t("Sì")} --> C[${t("Rilascio")}]\n  B -- ${t("No")} --> D[${t("Revisione")}]`;

/** Mermaid è grande: si carica solo quando una nota contiene davvero un diagramma. */
let library: Promise<typeof import("mermaid").default> | null = null;
function mermaid() {
  library ??= import("mermaid").then((m) => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral",
      fontFamily: "inherit",
    });
    return m.default;
  });
  return library;
}

let counter = 0;

/** Disegna `code` dentro `target`; se non è un diagramma valido mostra perché. */
async function draw(code: string, target: HTMLElement, stillCurrent: () => boolean) {
  if (!code.trim()) {
    target.replaceChildren(h("span", { class: "diagram-note" }, t("Diagramma vuoto")));
    return;
  }
  try {
    const lib = await mermaid();
    await lib.parse(code);
    const { svg } = await lib.render(`diagram-${++counter}`, code);
    if (stillCurrent()) target.innerHTML = svg;
  } catch (e) {
    if (!stillCurrent()) return;
    const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
    target.replaceChildren(
      h("span", { class: "diagram-note error" }, t("Diagramma non valido: {error}", { error: message })),
    );
  }
}

function render(view: BlockView<Diagram>) {
  const { code } = view.data;
  const editing = view.local.editing === true;
  const output = h("div", { class: "diagram-output" });
  let version = 0;
  const show = (source: string) => {
    const mine = ++version;
    draw(source, output, () => mine === version && output.isConnected);
  };

  const source = h("textarea", {
    class: "diagram-source",
    value: code,
    spellcheck: false,
    rows: Math.min(14, Math.max(4, code.split("\n").length + 1)),
    attrs: { "data-focus": "source", "aria-label": t("Codice Mermaid del diagramma") },
  });
  let preview = 0;
  const close = () => {
    window.clearTimeout(preview);
    view.local.editing = false;
    if (source.value !== code) view.set({ code: source.value });
    else view.redraw();
  };
  source.addEventListener("input", () => {
    // anteprima mentre si scrive, senza salvare a ogni tasto
    window.clearTimeout(preview);
    preview = window.setTimeout(() => show(source.value), 400);
  });
  source.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      close();
    }
  });

  view.dom.replaceChildren(
    output,
    ...(editing ? [source] : []),
    h(
      "div",
      { class: "block-foot" },
      h(
        "button",
        {
          type: "button",
          class: "block-add",
          on: {
            click: () => {
              if (editing) return close();
              view.local.editing = true;
              view.redraw();
              view.dom.querySelector<HTMLElement>("[data-focus=source]")?.focus();
            },
          },
        },
        editing ? t("Fatto") : t("Modifica il diagramma"),
      ),
      editing ? h("span", { class: "block-note" }, t("Sintassi Mermaid · ⌘Invio per chiudere")) : null,
    ),
  );
  show(code);
}

/**
 * Diagramma scritto come testo (Mermaid) e disegnato nella nota: flussi, sequenze, Gantt.
 * In Markdown è un blocco di codice ```mermaid, che anche GitHub e molti editor disegnano.
 */
const DiagramBlock = dataBlock<Diagram>({
  name: "diagram",
  tag: "mermaid",
  empty: { code: "" },
  ai: {
    format:
      "Un blocco di codice Mermaid (flowchart, sequenceDiagram, gantt, mindmap, stateDiagram, erDiagram…):\n\n```mermaid\nflowchart LR\n  A[Richiesta] --> B{Approvata?}\n  B -- Sì --> C[Rilascio]\n```\n\nIl codice deve essere Mermaid valido: metti tra virgolette le etichette con parentesi o caratteri speciali.",
  },
  format: {
    kind: "fence",
    parse: (code) => ({ code }),
    write: (data) => data.code.replace(/```/g, "'''").trimEnd(),
  },
  render,
});

export const diagram: EditorPlugin = {
  name: "diagram",
  extensions: () => [DiagramBlock],
  commands: [
    {
      id: "diagram",
      get title() {
        return t("Diagramma");
      },
      get hint() {
        return t("Flussi e sequenze scritti come testo");
      },
      icon: "⬡",
      get group() {
        return t("Strumenti");
      },
      keywords: ["diagramma", "mermaid", "flusso", "flowchart", "sequenza", "gantt", "schema"],
      run: (e) =>
        e
          .chain()
          .focus()
          .insertContent({ type: "diagram", attrs: { data: { code: sample() } } })
          .run(),
    },
  ],
};
