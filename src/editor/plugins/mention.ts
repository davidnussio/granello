import { Extension, Node, mergeAttributes } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type MarkdownIt from "markdown-it";
import { api } from "../../api";
import { t } from "../../i18n";
import { escAttr, once, type MdState } from "../markdown";
import type { CommandItem, EditorPlugin, SuggestMenu } from "../types";

/** Una persona citata nella nota. In Markdown: `@[Nome Cognome]`. */
const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-mention") ?? "",
        renderHTML: (attrs) => ({ "data-mention": attrs.name }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "mention" }), `@${node.attrs.name}`];
  },
  renderText({ node }) {
    return `@${node.attrs.name}`;
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: { attrs: { name: string } }) {
          state.write(`@[${node.attrs.name}]`);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "mention", () => {
              md.inline.ruler.before("link", "mention", (state, silent) => {
                const start = state.pos;
                if (state.src.charCodeAt(start) !== 0x40 || state.src.charCodeAt(start + 1) !== 0x5b) return false;
                const end = state.src.indexOf("]", start + 2);
                if (end < 0 || end >= state.posMax) return false;
                const name = state.src.slice(start + 2, end).trim();
                if (!name || name.length > 80 || /[[\n]/.test(name)) return false;
                if (!silent) {
                  state.push("html_inline", "", 0).content =
                    `<span data-mention="${escAttr(name)}">@${escAttr(name)}</span>`;
                }
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

const cleanName = (raw: string) => raw.replace(/[[\]\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

function person(name: string, hint?: string): CommandItem {
  return {
    id: `mention:${name}`,
    title: name,
    hint,
    icon: "@",
    get group() {
      return t("Persone");
    },
    run: (e) =>
      e
        .chain()
        .focus()
        .insertContent([{ type: "mention", attrs: { name } }, { type: "text", text: " " }])
        .run(),
  };
}

/** Digitando "@" propone le persone della rubrica e del calendario; un nome nuovo si può usare così com'è. */
function mentionSuggest(menu: SuggestMenu) {
  return Extension.create({
    name: "mentionSuggest",
    addProseMirrorPlugins() {
      return [
        Suggestion<CommandItem>({
          editor: this.editor,
          pluginKey: new PluginKey("mentionSuggest"),
          char: "@",
          allowSpaces: true,
          allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),
          items: async ({ query }) => {
            const typed = cleanName(query);
            // dopo qualche parola senza corrispondenze non è più un nome: il menu si chiude
            if (typed.split(" ").length > 4) return [];
            const found = await api.suggestPeople(typed).catch(() => []);
            const items = found.slice(0, 8).map((p) => person(p.name, p.email ?? undefined));
            const known = items.some((i) => i.title.toLowerCase() === typed.toLowerCase());
            if (typed && !known && !query.endsWith(" ")) items.push(person(typed, t("Usa questo nome")));
            return items;
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

export const mention: EditorPlugin = {
  name: "mention",
  extensions: ({ menu }) => [Mention, mentionSuggest(menu)],
  commands: [
    {
      id: "mention",
      get title() {
        return t("Persona");
      },
      get hint() {
        return t("@ + nome");
      },
      icon: "@",
      get group() {
        return t("Meeting");
      },
      keywords: ["persona", "menzione", "mention", "person", "chi"],
      run: (e) => e.chain().focus().insertContent("@").run(),
    },
  ],
};
