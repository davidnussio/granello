import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { api } from "../../api";
import { t } from "../../i18n";
import { backToEditor, escAttr, focusSoon, once, replaceParagraphs, type MdState } from "../markdown";
import type { EditorPlugin } from "../types";

function normalize(raw: string): string {
  const u = raw.trim();
  if (!u || /\s/.test(u)) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Un link mostrato come scheda, con titolo della pagina e sito. In Markdown resta un link
 * normale su una riga a sé, marcato dal titolo "preview": `[Titolo](https://… "preview")`.
 * Il titolo viene chiesto alla pagina una volta sola, quando si crea la scheda.
 */
const LinkCard = Node.create({
  name: "linkCard",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-url") ?? "",
        renderHTML: (a) => ({ "data-url": a.url }),
      },
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-title") ?? "",
        renderHTML: (a) => ({ "data-title": a.title }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-link-card]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-link-card": "" })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "link-card";
      dom.contentEditable = "false";
      let current = node;
      let typing = false;

      const position = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        return typeof pos === "number" ? pos : null;
      };
      const setAttrs = (attrs: { url: string; title: string }) => {
        const pos = position();
        if (pos !== null) editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, attrs));
      };

      const create = (raw: string) => {
        const url = normalize(raw);
        typing = false;
        const pos = position();
        if (!url) {
          if (pos !== null) editor.view.dispatch(editor.view.state.tr.delete(pos, pos + current.nodeSize));
          return;
        }
        setAttrs({ url, title: host(url) });
        api
          .linkTitle(url)
          .then((title) => {
            const at = position();
            // la scheda potrebbe essere stata tolta o cambiata nel frattempo
            if (title && at !== null && editor.view.state.doc.nodeAt(at)?.attrs.url === url)
              setAttrs({ url, title });
          })
          .catch(() => {});
      };

      const paint = () => {
        const { url, title } = current.attrs as { url: string; title: string };
        if (!url) {
          if (typing) return;
          typing = true;
          const input = document.createElement("input");
          input.className = "link-card-input";
          input.placeholder = t("Incolla un link e premi Invio");
          input.setAttribute("aria-label", t("Indirizzo del link"));
          input.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== "Escape") return;
            e.preventDefault();
            const pos = position();
            const size = current.nodeSize;
            const keep = e.key === "Enter" && !!normalize(input.value);
            create(e.key === "Enter" ? input.value : "");
            // dopo la scheda se resta, altrimenti dove stava
            if (pos !== null) backToEditor(editor, keep ? pos + size : pos);
          });
          input.addEventListener("blur", () => typing && create(input.value));
          dom.replaceChildren(input);
          if (editor.isEditable) focusSoon(() => input.focus());
          return;
        }
        const link = document.createElement("a");
        link.href = url;
        link.title = t("⌘+clic per aprire {url}", { url });
        const name = document.createElement("span");
        name.className = "link-card-title";
        name.textContent = title || host(url);
        const site = document.createElement("span");
        site.className = "link-card-site";
        site.textContent = host(url);
        link.append(name, site);
        dom.replaceChildren(link);
      };
      paint();

      return {
        dom,
        update(next) {
          if (next.type.name !== "linkCard") return false;
          current = next;
          paint();
          return true;
        },
        stopEvent: (e) => typing && dom.contains(e.target as globalThis.Node),
        ignoreMutation: () => true,
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          const { url, title } = node.attrs as { url: string; title: string };
          if (url) state.write(`[${(title || host(url)).replace(/[[\]\n]/g, " ").trim()}](${url} "preview")`);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "link-card", () => {
              replaceParagraphs(md, "link_card", (inline) => {
                const c = inline.children ?? [];
                if (
                  c.length !== 3 ||
                  c[0].type !== "link_open" ||
                  c[1].type !== "text" ||
                  c[2].type !== "link_close"
                )
                  return null;
                if (c[0].attrGet("title") !== "preview") return null;
                const url = c[0].attrGet("href") ?? "";
                return `<div data-link-card data-url="${escAttr(url)}" data-title="${escAttr(c[1].content)}"></div>`;
              });
            });
          },
        },
      },
    };
  },
});

export const linkCard: EditorPlugin = {
  name: "linkCard",
  extensions: () => [LinkCard],
  commands: [
    {
      id: "link-card",
      get title() {
        return t("Anteprima link");
      },
      get hint() {
        return t("Una scheda con titolo e sito");
      },
      icon: "🔗",
      get group() {
        return t("Allegati");
      },
      keywords: ["link", "anteprima", "preview", "scheda", "card", "url", "sito"],
      run: (e) => e.chain().focus().insertContent({ type: "linkCard" }).run(),
    },
  ],
};
