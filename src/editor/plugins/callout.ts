import { Node, mergeAttributes, wrappingInputRule } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type MarkdownIt from "markdown-it";
import { t } from "../../i18n";
import { once, type MdState } from "../markdown";
import type { CommandItem, EditorPlugin } from "../types";

const KINDS = ["note", "warning", "decision"] as const;
type Kind = (typeof KINDS)[number];
const kindOf = (raw: string | null | undefined): Kind => {
  const k = (raw ?? "").toLowerCase();
  // i tipi degli "alert" di GitHub che non abbiamo ricadono sul più vicino
  if (k === "caution" || k === "important") return "warning";
  return (KINDS as readonly string[]).includes(k) ? (k as Kind) : "note";
};

/** Riquadro evidenziato. In Markdown è una citazione che inizia con `[!NOTE]`, come gli alert di GitHub. */
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  // prima di blockquote: è una citazione con un attributo in più
  priority: 200,
  addAttributes() {
    return {
      kind: {
        default: "note",
        parseHTML: (el) => kindOf(el.getAttribute("data-callout")),
        renderHTML: (attrs) => ({ "data-callout": attrs.kind }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "blockquote[data-callout]" }, { tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "callout" }), 0];
  },
  addInputRules() {
    return [wrappingInputRule({ find: /^!\s$/, type: this.type })];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: Parameters<MdState["closeBlock"]>[0]) {
          state.wrapBlock("> ", null, node, () => {
            state.write(`[!${String(node.attrs.kind).toUpperCase()}]`);
            state.ensureNewLine();
            state.renderContent(node);
          });
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "callout", () => {
              md.core.ruler.push("callout", (state) => {
                const tokens = state.tokens;
                for (let i = tokens.length - 3; i >= 0; i--) {
                  if (tokens[i].type !== "blockquote_open" || tokens[i + 1].type !== "paragraph_open")
                    continue;
                  const inline = tokens[i + 2];
                  const first = inline.children?.[0];
                  const marker =
                    first?.type === "text" ? /^\[!([A-Za-z]+)\]$/.exec(first.content.trim()) : null;
                  const second = inline.children?.[1];
                  if (!marker || (second && second.type !== "softbreak")) continue;
                  tokens[i].attrSet("data-callout", kindOf(marker[1]));
                  inline.children!.splice(0, second ? 2 : 1);
                  // il marcatore era l'unica cosa nel paragrafo (segue un elenco, per esempio): il paragrafo sparisce
                  if (inline.children!.length === 0) tokens.splice(i + 1, 3);
                }
              });
            });
          },
        },
      },
    };
  },
});

function set(kind: Kind) {
  return (e: Editor) => {
    // dentro un riquadro il comando ne cambia il tipo, fuori ne crea uno
    if (e.isActive("callout")) e.chain().focus().updateAttributes("callout", { kind }).run();
    else e.chain().focus().wrapIn("callout", { kind }).run();
  };
}

const command = (
  kind: Kind,
  icon: string,
  title: () => string,
  hint: () => string,
  keywords: string[],
): CommandItem => ({
  id: `callout-${kind}`,
  get title() {
    return title();
  },
  get hint() {
    return hint();
  },
  icon,
  get group() {
    return t("Riquadri");
  },
  keywords: ["callout", "riquadro", "box", ...keywords],
  run: set(kind),
});

export const callout: EditorPlugin = {
  name: "callout",
  extensions: () => [Callout],
  commands: [
    command(
      "note",
      "ⓘ",
      () => t("Nota in evidenza"),
      () => t("! + spazio"),
      ["nota", "note", "info"],
    ),
    command(
      "warning",
      "⚠",
      () => t("Attenzione"),
      () => t("Un rischio o un punto critico"),
      ["attenzione", "warning", "rischio"],
    ),
    command(
      "decision",
      "✓",
      () => t("Riquadro decisione"),
      () => t("Una decisione, ben visibile"),
      ["decisione", "decision", "deciso"],
    ),
  ],
};
