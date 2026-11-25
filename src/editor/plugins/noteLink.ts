import { Extension, Node, mergeAttributes } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type MarkdownIt from "markdown-it";
import { api } from "../../api";
import { t } from "../../i18n";
import { escAttr, once, type MdState } from "../markdown";
import type { CommandItem, EditorPlugin, SuggestMenu } from "../types";

/** Evento con il titolo della nota da aprire: lo ascolta l'app, che sa quali note ci sono. */
export const OPEN_NOTE = "granello:open-note";

/**
 * Il titolo come lo scrive un link: senza parentesi quadre né barre, che chiuderebbero il link.
 * Uguale a `link_title` del backend, che aggiorna i link quando una nota cambia titolo.
 */
export function linkTitle(title: string): string {
  return title
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\|/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** Forme `[[…]]` che sono già altri blocchi: una data, il sommario, le stelle… */
const RESERVED = /^(\d{4}-\d{2}-\d{2}|toc|progress|(rating|timer|chart):.*)$/i;

/** I titoli delle note, per segnare i link a note che non ci sono. Riletti al più ogni 5 secondi. */
let titles: { at: number; set: Promise<Set<string>> } | null = null;
function knownTitles(): Promise<Set<string>> {
  if (!titles || Date.now() - titles.at > 5000) {
    titles = {
      at: Date.now(),
      set: api
        .listMeetings()
        .then((list) => new Set(list.map((m) => linkTitle(m.title).toLowerCase())))
        .catch(() => new Set<string>()),
    };
  }
  return titles.set;
}

/** Un link a un'altra nota, per titolo. In Markdown: `[[Titolo]]` o `[[Titolo|testo]]`. */
const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      title: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-note-link") ?? "",
        renderHTML: (attrs) => ({ "data-note-link": attrs.title }),
      },
      label: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-label") ?? "",
        renderHTML: (attrs) => (attrs.label ? { "data-label": attrs.label } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-note-link]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "note-link" }),
      node.attrs.label || node.attrs.title,
    ];
  },
  renderText({ node }) {
    return node.attrs.label || node.attrs.title;
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = "note-link";
      dom.contentEditable = "false";
      dom.setAttribute("role", "link");
      let current = node;
      const paint = () => {
        const { title, label } = current.attrs as { title: string; label: string };
        dom.textContent = label || title;
        dom.title = t("Apri la nota «{title}»", { title });
        void knownTitles().then((set) => {
          const missing = !set.has(linkTitle(title).toLowerCase());
          dom.classList.toggle("missing", missing);
          if (missing) dom.title = t("Nessuna nota si chiama «{title}»", { title });
        });
      };
      paint();
      dom.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent<string>(OPEN_NOTE, { detail: current.attrs.title }));
      });
      return {
        dom,
        update(next) {
          if (next.type.name !== "noteLink") return false;
          current = next;
          paint();
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: { attrs: { title: string; label: string } }) {
          const title = linkTitle(node.attrs.title);
          const label = linkTitle(node.attrs.label);
          state.write(label && label !== title ? `[[${title}|${label}]]` : `[[${title}]]`);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "noteLink", () => {
              md.inline.ruler.before("link", "noteLink", (state, silent) => {
                const start = state.pos;
                if (state.src.charCodeAt(start) !== 0x5b || state.src.charCodeAt(start + 1) !== 0x5b)
                  return false;
                const end = state.src.indexOf("]]", start + 2);
                if (end < 0 || end >= state.posMax) return false;
                // in una cella di tabella la barra è scritta `\|`
                const inner = state.src.slice(start + 2, end).replace(/\\\|/g, "|");
                if (!inner.trim() || inner.length > 400 || /[[\n]/.test(inner)) return false;
                const [title, ...rest] = inner.split("|");
                if (RESERVED.test(title.trim())) return false;
                if (!silent) {
                  const label = rest.join("|").trim();
                  state.push("html_inline", "", 0).content =
                    `<span data-note-link="${escAttr(title.trim())}"` +
                    (label ? ` data-label="${escAttr(label)}"` : "") +
                    `>${escAttr(label || title.trim())}</span>`;
                }
                state.pos = end + 2;
                return true;
              });
            });
          },
        },
      },
    };
  },
});

function noteItem(title: string, hint?: string): CommandItem {
  return {
    id: `note-link:${title}`,
    title,
    hint,
    icon: "↗",
    get group() {
      return t("Note");
    },
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent([
          { type: "noteLink", attrs: { title: linkTitle(title), label: "" } },
          { type: "text", text: " " },
        ])
        .run(),
  };
}

/** Digitando "[[" propone le note per titolo; un titolo nuovo si può usare così com'è. */
function noteLinkSuggest(menu: SuggestMenu) {
  return Extension.create({
    name: "noteLinkSuggest",
    addProseMirrorPlugins() {
      return [
        Suggestion<CommandItem>({
          editor: this.editor,
          pluginKey: new PluginKey("noteLinkSuggest"),
          char: "[[",
          allowSpaces: true,
          allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),
          items: async ({ query }) => {
            const typed = linkTitle(query.replace(/\]+$/, ""));
            if (typed.split(" ").length > 8) return [];
            const q = typed.toLowerCase();
            const list = await api.listMeetings().catch(() => []);
            const found = list
              .filter((m) => !q || m.title.toLowerCase().includes(q))
              .toSorted((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 8)
              .map((m) => noteItem(m.title));
            const known = found.some((i) => i.title.toLowerCase() === q);
            if (typed && !known && !RESERVED.test(typed))
              found.push(noteItem(typed, t("Collega una nota che non c'è ancora")));
            return found;
          },
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
          render: () => ({
            onStart: (p) => menu.set(p.items.length ? p : null),
            onUpdate: (p) => menu.set(p.items.length ? p : null),
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                menu.set(null);
                return true;
              }
              return menu.onKeyDown(event);
            },
            onExit: () => menu.set(null),
          }),
        }),
      ];
    },
  });
}

export const noteLink: EditorPlugin = {
  name: "noteLink",
  extensions: ({ menu }) => [NoteLink, noteLinkSuggest(menu)],
  commands: [
    {
      id: "note-link",
      get title() {
        return t("Link a una nota");
      },
      get hint() {
        return t("[[ + titolo");
      },
      icon: "↗",
      get group() {
        return t("Note");
      },
      keywords: ["link", "nota", "note", "collegamento", "wikilink", "obsidian"],
      run: (e) => e.chain().focus().insertContent("[[").run(),
    },
  ],
};
