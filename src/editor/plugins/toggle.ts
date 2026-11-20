import { Node, mergeAttributes } from "@tiptap/react";
import { Selection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { t } from "../../i18n";
import { cursorToStartOf, fence, once, useContainer, type MdState } from "../markdown";
import type { EditorPlugin } from "../types";

/** Il titolo di una sezione richiudibile: resta visibile anche quando è chiusa. */
const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-toggle-summary]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-toggle-summary": "",
        class: "toggle-summary",
        "data-placeholder": t("Titolo della sezione"),
      }),
      0,
    ];
  },
  addStorage() {
    // scritto dal nodo che lo contiene
    return { markdown: { serialize() {} } };
  },
});

/**
 * Sezione richiudibile. In Markdown è un contenitore `::: details Titolo` … `:::`.
 * Aperta o chiusa è solo una vista: quando si riapre la nota le sezioni sono chiuse.
 */
const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary block+",
  defining: true,
  addAttributes() {
    return { open: { default: false, rendered: false } };
  },
  parseHTML() {
    return [{ tag: "div[data-toggle]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), 0];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "toggle";
      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.className = "toggle-arrow";
      arrow.contentEditable = "false";
      arrow.textContent = "▸";
      const content = document.createElement("div");
      content.className = "toggle-content";
      dom.append(arrow, content);

      let open: boolean = node.attrs.open;
      const paint = () => {
        dom.classList.toggle("open", open);
        arrow.setAttribute("aria-expanded", String(open));
        arrow.title = open ? t("Chiudi la sezione") : t("Apri la sezione");
      };
      paint();
      arrow.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos !== "number") return;
        const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, { open: !open });
        editor.view.dispatch(tr.setMeta("addToHistory", false));
      });

      return {
        dom,
        contentDOM: content,
        update(next) {
          if (next.type.name !== "toggle") return false;
          open = next.attrs.open;
          paint();
          return true;
        },
        ignoreMutation: (m) => !content.contains(m.target),
      };
    };
  },
  addKeyboardShortcuts() {
    return {
      // Invio nel titolo: si passa al contenuto, aprendo la sezione
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.parent.type.name !== "toggleSummary") return false;
        const tr = state.tr.setNodeMarkup($from.before($from.depth - 1), undefined, { open: true });
        tr.setSelection(Selection.near(tr.doc.resolve($from.after($from.depth) + 1)));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      // Cancella all'inizio del titolo: se è vuoto la sezione si scioglie e resta il contenuto
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== "toggleSummary" || $from.parentOffset > 0) return false;
        if ($from.parent.content.size > 0) return true;
        const toggle = $from.node($from.depth - 1);
        const start = $from.before($from.depth - 1);
        const body: PMNode[] = [];
        toggle.forEach((child, _offset, i) => {
          if (i > 0) body.push(child);
        });
        const tr = state.tr.replaceWith(start, start + toggle.nodeSize, body);
        tr.setSelection(Selection.near(tr.doc.resolve(start + 1)));
        view.dispatch(tr);
        return true;
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          const marker = fence(node);
          state.write(`${marker} details `);
          state.renderInline(node.child(0));
          state.ensureNewLine();
          node.forEach((child, _offset, i) => {
            if (i > 0) state.render(child, node, i);
          });
          state.write(marker);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "toggle", () => {
              useContainer(
                md,
                "details",
                (title) => `<div data-toggle><div data-toggle-summary>${md.renderInline(title)}</div>`,
              );
            });
          },
        },
      },
    };
  },
});

export const toggle: EditorPlugin = {
  name: "toggle",
  extensions: () => [ToggleSummary, Toggle],
  commands: [
    {
      id: "toggle",
      get title() {
        return t("Sezione richiudibile");
      },
      get hint() {
        return t("Dettagli da aprire quando servono");
      },
      icon: "▸",
      get group() {
        return t("Blocchi");
      },
      keywords: ["toggle", "richiudibile", "dettagli", "details", "collapse", "nascondi"],
      run: (e) =>
        e
          .chain()
          .focus()
          .insertContent({
            type: "toggle",
            attrs: { open: true },
            content: [{ type: "toggleSummary" }, { type: "paragraph" }],
          })
          // si comincia dal titolo; Invio porta poi al contenuto
          .command(cursorToStartOf("toggle"))
          .run(),
    },
  ],
};
