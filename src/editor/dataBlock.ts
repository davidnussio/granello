import { Node, mergeAttributes } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { CONTAINERS, escAttr, focusSoon, once, rawContainer, replaceParagraphs, type MdState } from "./markdown";
import { NEEDS_PARAGRAPH_AFTER } from "./trailing";

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
        const paint = () => {
          spec.render(view);
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
