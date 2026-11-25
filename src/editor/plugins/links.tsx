import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import Link from "@tiptap/extension-link";
import { defaultMarkdownSerializer } from "@tiptap/pm/markdown";
import type { Editor } from "@tiptap/react";
import type { Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { once } from "../markdown";
import type { EditorPlugin } from "../types";

function normalize(url: string): string {
  const u = url.trim();
  if (!u) return "";
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : `https://${u}`;
}

function LinkPanel({ editor, close }: { editor: Editor; close: () => void }) {
  const current = (editor.getAttributes("link").href as string | undefined) ?? "";
  const [url, setUrl] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const apply = () => {
    const href = normalize(url);
    const chain = editor.chain().focus().extendMarkRange("link");
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    close();
  };

  return (
    <form
      className="tb-panel"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <input
        ref={input}
        value={url}
        placeholder={t("Incolla o scrivi un link…")}
        aria-label={t("Indirizzo del link")}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            editor.commands.focus();
            close();
          }
        }}
      />
      <button type="submit" className="tb-btn" title={t("Applica")}>
        ↵
      </button>
      {current && (
        <button
          type="button"
          className="tb-btn"
          title={t("Rimuovi link")}
          onClick={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            close();
          }}
        >
          ✕
        </button>
      )}
    </form>
  );
}

const linkMd = defaultMarkdownSerializer.marks.link;
type MarkOpen = (state: unknown, mark: PMMark, parent: PMNode, index: number) => string;

const countOf = (s: string, c: string) => s.split(c).length - 1;

/**
 * Toglie dalla fine di un indirizzo nudo quello che non ne fa parte, come GitHub: punteggiatura
 * finale e `)` senza la sua `(`.
 */
function trimUrlTail(url: string): string {
  for (;;) {
    if (/[?!.,:*_~]$/.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(")") && countOf(url, ")") > countOf(url, "(")) url = url.slice(0, -1);
    else return url;
  }
}

/** Un `\` davanti a punteggiatura ASCII (escape del Markdown): nel testo del link e nell'URL. */
const ESCAPE_IN_TEXT = /\\(?=[!-/:-@[-`{-~])/g;
const ESCAPE_IN_HREF = /%5C(?=[!-/:-@[-`{-~])/gi;

/**
 * Gli indirizzi nudi nel testo diventano link (linkify), ma linkify-it li legge dal testo grezzo
 * e sbaglia in due casi, che qui si correggono.
 * - Prende anche gli escape: un indirizzo non ancora link si salva `…?\_g=…`, e il `\` finirebbe
 *   nell'URL (`%5C_g`). In un URL un `\` non è valido, quindi davanti a punteggiatura è un escape.
 * - Si ferma alle parentesi annidate: di `…?_g=(filters:!())&_a=(…)`, tipico di Kibana, prende
 *   solo `…?_g=(filters:!()`. Quando il link finisce davanti a una `)`, si riprende il resto
 *   dell'indirizzo, fin dove arrivano i caratteri ammessi in un URL.
 */
function fixBareLinks(md: MarkdownIt) {
  md.core.ruler.push("granello_bare_links", (state) => {
    for (const block of state.tokens) {
      const tokens = block.children ?? [];
      for (let i = 0; i + 2 < tokens.length; i++) {
        const [open, text, close, next] = tokens.slice(i, i + 4);
        if (open.type !== "link_open" || open.markup !== "linkify") continue;
        if (text.type !== "text" || close.type !== "link_close") continue;
        let href = (open.attrGet("href") ?? "").replace(ESCAPE_IN_HREF, "");
        text.content = text.content.replace(ESCAPE_IN_TEXT, "");
        if (next?.type === "text" && next.content.startsWith(")")) {
          const run = /^[\w\-.~:/?#[\]@!$&'()*+,;=%]*/.exec(next.content)?.[0] ?? "";
          const extra = trimUrlTail(text.content + run).slice(text.content.length);
          if (extra && md.validateLink(href + md.normalizeLink(extra))) {
            href += md.normalizeLink(extra);
            text.content += md.normalizeLinkText(extra);
            next.content = next.content.slice(extra.length);
          }
        }
        open.attrSet("href", href);
      }
    }
  });
}

/**
 * Un link il cui testo è l'indirizzo si scrive `<https://…>`, il cui testo non va escapato (vedi
 * il nodo di testo in `base.ts`). Va bene solo se l'indirizzo non ha spazi né `<` `>`: altrimenti
 * `[testo](indirizzo)`.
 */
const NoteLink = Link.extend({
  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        parse: {
          setup(md: MarkdownIt) {
            once(md, "bare-links", () => fixBareLinks(md));
          },
        },
        serialize: {
          ...linkMd,
          open(state: { inAutolink?: boolean }, mark: PMMark, parent: PMNode, index: number) {
            const open = (linkMd.open as MarkOpen)(state, mark, parent, index);
            if (!state.inAutolink || !/[\s<>]/.test(String(mark.attrs.href))) return open;
            state.inAutolink = false;
            return "[";
          },
        },
      },
    };
  },
});

export const links: EditorPlugin = {
  name: "links",
  extensions: () => [
    NoteLink.configure({
      // l'apertura è gestita a livello di app: ⌘+click apre nel browser
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: ["http", "https", "mailto"],
      // oltre agli indirizzi web, i link agli allegati della nota (percorso relativo)
      isAllowedUri: (url, ctx) => url.startsWith("attachments/") || ctx.defaultValidate(url),
      HTMLAttributes: { rel: "noopener noreferrer" },
    }),
  ],
  toolbar: [
    {
      id: "link",
      group: "link",
      label: "🔗",
      get title() {
        return t("Link");
      },
      isActive: (e) => e.isActive("link"),
      panel: LinkPanel,
    },
  ],
};
