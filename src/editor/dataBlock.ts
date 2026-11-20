import { Node, mergeAttributes } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { CONTAINERS, escAttr, focusSoon, once, rawContainer, replaceParagraphs, type MdState } from "./markdown";
import { NEEDS_PARAGRAPH_AFTER } from "./trailing";
import { askAi } from "./aiContext";
import { micButton } from "./dictation";
import { h } from "./dom";
import { errorText, notify } from "../api";
import { t } from "../i18n";

/** Ciò che un blocco con dati vede di sé mentre si disegna. */
export interface BlockView<T> {
  dom: HTMLElement;
  editor: Editor;
  /** I dati correnti del blocco. */
  data: T;
  /** Salva nuovi dati. `focus` è il `data-focus` del campo su cui tornare dopo il ridisegno. */
  set(next: T, focus?: string): void;
  /** Posizione del blocco nel documento, o null se non è più nel documento. */
  pos(): number | null;
  /** Ridisegna il blocco con gli stessi dati (è cambiato solo lo stato in `local`). */
  redraw(): void;
  /** Stato che sopravvive ai ridisegni (un timer in corsa, un modulo caricato…). */
  local: Record<string, unknown>;
  /** Da eseguire quando il blocco viene tolto. */
  cleanup: (() => void)[];
}

/** Come il blocco si scrive in Markdown. */
type Format<T> =
  /** `::: nome info` + righe + `:::` */
  | { kind: "container"; parse(info: string, lines: string[]): T; write(data: T): { info?: string; lines: string[] } }
  /** una riga a sé, es. `[[timer:05:00]]` */
  | { kind: "line"; match: RegExp; parse(match: RegExpExecArray): T; write(data: T): string }
  /** un blocco di codice con quel linguaggio, es. ```mermaid */
  | { kind: "fence"; parse(code: string): T; write(data: T): string };

export interface DataBlockSpec<T> {
  /** Nome del nodo nell'editor. */
  name: string;
  /** Nome in Markdown: del contenitore o del linguaggio del blocco di codice. */
  tag: string;
  empty: T;
  format: Format<T>;
  /** Disegna il blocco dentro `view.dom` a partire da `view.data`. Chiamato a ogni cambio dei dati. */
  render(view: BlockView<T>): void;
  /** `data-focus` del campo da cui partire quando il blocco è appena stato inserito vuoto. */
  autofocus?: string;
  /**
   * Se presente, il blocco ha il pulsante ✦: l'AI lo crea o lo modifica a richiesta, scrivendolo
   * nel suo formato Markdown. `format` spiega quel formato al modello, con un esempio.
   */
  ai?: { format: string };
}

/** Il blocco scritto in Markdown, come lo vede l'AI e come finisce nella nota. */
function toMarkdown<T>(tag: string, format: Format<T>, data: T): string {
  if (format.kind === "line") return format.write(data);
  if (format.kind === "fence") return `\`\`\`${tag}\n${format.write(data)}\n\`\`\``;
  const { info, lines } = format.write(data);
  return [`::: ${tag}${info ? ` ${info.replace(/\s+/g, " ").trim()}` : ""}`, ...lines, ":::"].join("\n");
}

/** Rilegge un blocco dal Markdown scritto dall'AI; null se non è nel formato del blocco. */
function fromMarkdown<T>(tag: string, format: Format<T>, text: string): T | null {
  const lines = text.trim().split("\n");
  if (format.kind === "line") {
    const m = format.match.exec(lines[0]?.trim() ?? "");
    return m ? format.parse(m) : null;
  }
  if (format.kind === "fence") {
    const open = lines.findIndex((l) => l.trim().startsWith("```"));
    if (open < 0) return format.parse(text.trim());
    const close = lines.findIndex((l, i) => i > open && l.trim().startsWith("```"));
    return format.parse(lines.slice(open + 1, close < 0 ? undefined : close).join("\n"));
  }
  const open = lines.findIndex((l) => new RegExp(`^:{3,}\\s*${tag}(\\s|$)`).test(l.trim()));
  if (open < 0) return null;
  const info = lines[open].trim().replace(/^:+\s*[\w-]+\s*/, "");
  const close = lines.findIndex((l, i) => i > open && /^:{3,}\s*$/.test(l.trim()));
  return format.parse(info, lines.slice(open + 1, close < 0 ? undefined : close));
}

/** Il pulsante ✦ di un blocco e il campo in cui si scrive la richiesta per l'AI. */
function aiControls<T>(view: BlockView<T>, spec: DataBlockSpec<T>) {
  const state = { open: false, busy: false };
  const input = h("input", { type: "text", class: "block-ai-input" });
  const mic = micButton(input);
  const bar = h("div", { class: "block-ai-bar" }, h("span", { class: "block-ai-mark", attrs: { "aria-hidden": "true" } }, "✦"), input, mic.button);
  const button = h("button", { type: "button", class: "block-ai-btn" }, "✦");
  const refresh = () => {
    button.title = t("Crea o modifica con l'AI");
    button.classList.toggle("on", state.open);
    input.disabled = state.busy;
    input.placeholder = state.busy ? t("L'AI sta scrivendo…") : t("Chiedi all'AI: cosa creare o cosa cambiare");
    input.setAttribute("aria-label", t("Richiesta per l'AI"));
    bar.classList.toggle("busy", state.busy);
    if (state.open) view.dom.append(bar);
    else {
      mic.cancel();
      bar.remove();
    }
    view.dom.append(button);
  };
  const submit = async () => {
    const instruction = input.value.trim();
    if (!instruction || state.busy) return;
    state.busy = true;
    refresh();
    try {
      const answer = await askAi({
        kind: "block",
        instruction,
        current: toMarkdown(spec.tag, spec.format, view.data),
        format: spec.ai!.format,
      });
      const next = fromMarkdown(spec.tag, spec.format, answer);
      if (next === null) notify(t("L'AI non ha risposto nel formato del blocco. Riprova."));
      else {
        input.value = "";
        state.open = false;
        view.set(next);
      }
    } catch (e) {
      notify(errorText(e));
    } finally {
      state.busy = false;
      refresh();
    }
  };
  button.addEventListener("click", () => {
    state.open = !state.open;
    refresh();
    if (state.open) input.focus();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && !state.busy) {
      e.preventDefault();
      state.open = false;
      refresh();
    }
  });
  view.cleanup.push(() => mic.cancel());
  return refresh;
}

/**
 * Un blocco dell'editor fatto di dati (non di testo formattato) con una sua piccola
 * interfaccia: sondaggio, lavagna a colonne, timer… Si salva in Markdown nella forma
 * dichiarata da `format`, così la nota resta leggibile anche fuori da Granello.
 */
export function dataBlock<T>(spec: DataBlockSpec<T>) {
  const { name, tag, format } = spec;
  NEEDS_PARAGRAPH_AFTER.add(name);
  if (format.kind === "container") CONTAINERS.add(name);
  const html = (data: T) => `<div data-block="${tag}" data-json="${escAttr(JSON.stringify(data))}"></div>`;

  return Node.create({
    name,
    group: "block",
    atom: true,
    addAttributes() {
      return {
        data: {
          default: spec.empty,
          parseHTML: (el) => {
            try {
              return JSON.parse(el.getAttribute("data-json") ?? "") as T;
            } catch {
              return spec.empty;
            }
          },
          renderHTML: (attrs) => ({ "data-json": JSON.stringify(attrs.data) }),
        },
      };
    },
    parseHTML() {
      return [{ tag: `div[data-block="${tag}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-block": tag })];
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement("div");
        dom.className = `data-block block-${tag}`;
        dom.contentEditable = "false";
        let focusNext: string | undefined;
        const view: BlockView<T> = {
          dom,
          editor,
          data: node.attrs.data as T,
          local: {},
          cleanup: [],
          redraw: () => paint(),
          pos() {
            const pos = typeof getPos === "function" ? getPos() : undefined;
            return typeof pos === "number" ? pos : null;
          },
          set(next, focus) {
            const pos = view.pos();
            if (pos === null) return;
            focusNext = focus;
            editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { data: next }));
          },
        };
        const ai = spec.ai && editor.isEditable ? aiControls(view, spec) : null;
        const paint = () => {
          spec.render(view);
          ai?.();
          if (focusNext) dom.querySelector<HTMLElement>(`[data-focus="${focusNext}"]`)?.focus();
          focusNext = undefined;
        };
        paint();
        const isNew = JSON.stringify(node.attrs.data) === JSON.stringify(spec.empty);
        if (isNew && spec.autofocus && editor.isEditable) {
          focusSoon(() => dom.querySelector<HTMLElement>(`[data-focus="${spec.autofocus}"]`)?.focus());
        }
        return {
          dom,
          update(next) {
            if (next.type.name !== name) return false;
            view.data = next.attrs.data as T;
            paint();
            return true;
          },
          // quello che succede dentro il blocco (scrivere, cliccare, trascinare) è affare suo
          stopEvent: (e) => dom.contains(e.target as globalThis.Node),
          ignoreMutation: () => true,
          destroy: () => view.cleanup.forEach((fn) => fn()),
        };
      };
    },
    addStorage() {
      return {
        markdown: {
          serialize(state: MdState, node: PMNode) {
            const data = node.attrs.data as T;
            if (format.kind === "container") {
              const { info, lines } = format.write(data);
              state.write(`::: ${tag}${info ? ` ${info.replace(/\s+/g, " ").trim()}` : ""}`);
              state.ensureNewLine();
              if (lines.length) {
                state.text(lines.join("\n"), false);
                state.ensureNewLine();
              }
              state.write(":::");
            } else if (format.kind === "line") {
              state.write(format.write(data));
            } else {
              state.text(`\`\`\`${tag}\n${format.write(data)}\n\`\`\``, false);
            }
            state.closeBlock(node);
          },
          parse: {
            setup(md: MarkdownIt) {
              once(md, `block-${tag}`, () => {
                if (format.kind === "container") {
                  rawContainer(md, tag, (info, lines) => html(format.parse(info, lines)));
                } else if (format.kind === "line") {
                  replaceParagraphs(md, `block_${tag}`, (inline) => {
                    const m = format.match.exec(inline.content.trim());
                    return m ? html(format.parse(m)) : null;
                  });
                } else {
                  const fallback = md.renderer.rules.fence!;
                  md.renderer.rules.fence = (tokens, idx, options, env, self) =>
                    tokens[idx].info.trim() === tag
                      ? html(format.parse(tokens[idx].content.replace(/\n$/, "")))
                      : fallback(tokens, idx, options, env, self);
                }
              });
            },
          },
        },
      };
    },
  });
}
