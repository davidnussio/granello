import { InputRule, Node, mergeAttributes } from "@tiptap/react";
import type { NodeViewRenderer } from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import katex from "katex";
import "katex/dist/katex.min.css";
import { t } from "../../i18n";
import { backToEditor, escAttr, focusSoon, once, type MdState } from "../markdown";
import type { EditorPlugin } from "../types";

/**
 * Formula resa con KaTeX. Un clic la apre come testo LaTeX; Invio (⌘Invio per i blocchi)
 * conferma, Esc annulla, vuota si elimina.
 */
function mathView(display: boolean): NodeViewRenderer {
  return ({ node, getPos, editor }) => {
    const name = node.type.name;
    const dom = document.createElement(display ? "div" : "span");
    dom.className = display ? "math-block" : "math-inline";
    dom.contentEditable = "false";
    const out = document.createElement("span");
    out.className = "math-render";
    const input = document.createElement(display ? "textarea" : "input");
    input.className = "math-input";
    input.spellcheck = false;
    input.placeholder = "LaTeX";
    input.setAttribute("aria-label", t("Formula in LaTeX"));
    dom.append(out, input);

    let current = node;
    let editing = false;

    const paint = () => {
      const latex: string = current.attrs.latex;
      dom.classList.toggle("editing", editing);
      out.classList.toggle("empty", !latex.trim());
      if (!latex.trim()) {
        out.textContent = t("Formula");
        return;
      }
      try {
        katex.render(latex, out, { displayMode: display, throwOnError: false });
      } catch {
        out.textContent = latex;
      }
    };

    const position = () => {
      const pos = typeof getPos === "function" ? getPos() : undefined;
      return typeof pos === "number" ? pos : null;
    };

    const finish = (save: boolean) => {
      if (!editing) return;
      editing = false;
      const pos = position();
      const value = save ? input.value.trim() : (current.attrs.latex as string);
      if (pos !== null) {
        const tr = editor.view.state.tr;
        if (!value) tr.delete(pos, pos + current.nodeSize);
        else if (value !== current.attrs.latex) tr.setNodeMarkup(pos, undefined, { latex: value });
        if (tr.docChanged) editor.view.dispatch(tr);
      }
      paint();
    };

    const edit = () => {
      if (editing || !editor.isEditable) return;
      editing = true;
      input.value = current.attrs.latex;
      paint();
      input.focus();
      input.select();
    };

    out.addEventListener("mousedown", (e) => {
      e.preventDefault();
      edit();
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      const key = (e as KeyboardEvent).key;
      const confirm =
        key === "Enter" && (!display || (e as KeyboardEvent).metaKey || (e as KeyboardEvent).ctrlKey);
      if (!confirm && key !== "Escape") return;
      e.preventDefault();
      const pos = position();
      const size = current.nodeSize;
      finish(key !== "Escape");
      // si torna a scrivere subito dopo la formula
      if (pos !== null) backToEditor(editor, pos + size);
    });

    paint();
    // una formula appena inserita è vuota: si apre già pronta da scrivere
    if (!node.attrs.latex && editor.isEditable) focusSoon(edit);

    return {
      dom,
      update(next) {
        if (next.type.name !== name) return false;
        current = next;
        if (!editing) paint();
        return true;
      },
      stopEvent: (e) => editing && dom.contains(e.target as globalThis.Node),
      ignoreMutation: () => true,
    };
  };
}

const latexAttr = (attribute: string) => ({
  latex: {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute(attribute) ?? "",
    renderHTML: (attrs: { latex: string }) => ({ [attribute]: attrs.latex }),
  },
});

/** In Markdown: `$E = mc^2$`. */
const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return latexAttr("data-math");
  },
  parseHTML() {
    return [{ tag: "span[data-math]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), `$${node.attrs.latex}$`];
  },
  renderText({ node }) {
    return `$${node.attrs.latex}$`;
  },
  addNodeView() {
    return mathView(false);
  },
  addInputRules() {
    const type = this.type;
    return [
      // "$x^2$" diventa una formula appena si chiude il secondo "$"
      new InputRule({
        find: /(?:^|\s)\$([^$\s](?:[^$]*[^$\s])?)\$$/,
        handler: ({ state, range, match }) => {
          const start = range.from + match[0].indexOf("$");
          state.tr.replaceWith(start, range.to, type.create({ latex: match[1] }));
        },
      }),
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: { attrs: { latex: string } }) {
          if (node.attrs.latex.trim()) state.write(`$${node.attrs.latex.trim()}$`);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "math-inline", () => {
              md.inline.ruler.before("escape", "math_inline", (state, silent) => {
                const start = state.pos;
                if (state.src.charCodeAt(start) !== 0x24 || state.src.charCodeAt(start + 1) === 0x24)
                  return false;
                let end = start + 1;
                while ((end = state.src.indexOf("$", end)) !== -1 && state.src.charCodeAt(end - 1) === 0x5c)
                  end++;
                if (end < 0 || end >= state.posMax) return false;
                const latex = state.src.slice(start + 1, end);
                // "costa $5 e poi $10": uno spazio dentro i bordi o una cifra subito dopo non è una formula
                if (!latex || /^\s|\s$|\n/.test(latex) || /\d/.test(state.src.charAt(end + 1))) return false;
                if (!silent)
                  state.push("html_inline", "", 0).content = `<span data-math="${escAttr(latex)}"></span>`;
                state.pos = end + 1;
                return true;
              });
            });
          },
        },
      },
    };
  },
});

/** In Markdown: un blocco tra due righe `$$`. */
const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return latexAttr("data-math-block");
  },
  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), `$$${node.attrs.latex}$$`];
  },
  addNodeView() {
    return mathView(true);
  },
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          state.tr.replaceRangeWith(range.from, range.to, type.create());
        },
      }),
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: Parameters<MdState["closeBlock"]>[0]) {
          const latex = (node.attrs.latex as string).trim();
          if (latex) state.text(`$$\n${latex}\n$$`, false);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "math-block", () => {
              md.block.ruler.before(
                "fence",
                "math_block",
                (state, startLine, endLine, silent) => {
                  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
                  const line = (n: number) =>
                    state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
                  const first = line(startLine);
                  if (!first.startsWith("$$")) return false;
                  const rest = first.slice(2).trim();
                  let last = startLine;
                  let latex: string;
                  if (rest.length >= 2 && rest.endsWith("$$")) {
                    latex = rest.slice(0, -2); // tutto su una riga: $$ x $$
                  } else {
                    const lines = [rest];
                    let closed = false;
                    for (last = startLine + 1; last < endLine; last++) {
                      const l = line(last).trimEnd();
                      if (l.endsWith("$$")) {
                        lines.push(l.slice(0, -2));
                        closed = true;
                        break;
                      }
                      lines.push(l);
                    }
                    if (!closed) return false;
                    latex = lines.join("\n");
                  }
                  if (silent) return true;
                  const token = state.push("html_block", "", 0);
                  token.content = `<div data-math-block="${escAttr(latex.trim())}"></div>`;
                  token.map = [startLine, last + 1];
                  state.line = last + 1;
                  return true;
                },
                { alt: ["paragraph", "reference", "blockquote", "list"] },
              );
            });
          },
        },
      },
    };
  },
});

export const math: EditorPlugin = {
  name: "math",
  extensions: () => [MathInline, MathBlock],
  commands: [
    {
      id: "math-inline",
      get title() {
        return t("Formula");
      },
      get hint() {
        return t("$…$ nel testo");
      },
      icon: "∑",
      get group() {
        return t("Blocchi");
      },
      keywords: ["formula", "math", "matematica", "latex", "equazione"],
      run: (e) => e.chain().focus().insertContent({ type: "mathInline" }).run(),
    },
    {
      id: "math-block",
      get title() {
        return t("Formula a blocco");
      },
      get hint() {
        return t("$$ + spazio");
      },
      icon: "∫",
      get group() {
        return t("Blocchi");
      },
      keywords: ["formula", "math", "matematica", "latex", "equazione", "blocco"],
      run: (e) => e.chain().focus().insertContent({ type: "mathBlock" }).run(),
    },
  ],
};
