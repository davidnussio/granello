import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type MarkdownIt from "markdown-it";
import { h } from "../dom";
import { t } from "../../i18n";
import { backToEditor, escAttr, focusSoon, once, replaceParagraphs, type MdState } from "../markdown";
import { NEEDS_PARAGRAPH_AFTER } from "../trailing";
import type { EditorPlugin } from "../types";

NEEDS_PARAGRAPH_AFTER.add("embed");

interface Source {
  provider: string;
  /** Indirizzo da caricare nel riquadro. */
  src: string;
  /** Proporzione altezza/larghezza del riquadro. */
  ratio: number;
}

/**
 * L'indirizzo da incorporare per un link a un servizio conosciuto, o null. Gli host qui sotto
 * sono gli stessi ammessi dalla Content-Security-Policy dell'app (`frame-src`).
 */
export function embedSource(raw: string): Source | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;

  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com") {
    const id = host === "youtu.be" ? path.slice(1) : url.searchParams.get("v") ?? /^\/(?:embed|shorts|live)\/([\w-]+)/.exec(path)?.[1];
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    // senza cookie finché non si preme play
    return { provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${id}`, ratio: 9 / 16 };
  }
  if (host === "vimeo.com") {
    const id = /^\/(\d+)/.exec(path)?.[1];
    return id ? { provider: "Vimeo", src: `https://player.vimeo.com/video/${id}?dnt=1`, ratio: 9 / 16 } : null;
  }
  if (host === "loom.com") {
    const id = /^\/(?:share|embed)\/([a-f0-9]{20,})/.exec(path)?.[1];
    return id ? { provider: "Loom", src: `https://www.loom.com/embed/${id}`, ratio: 9 / 16 } : null;
  }
  if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(path)) {
    return { provider: "Figma", src: `https://www.figma.com/embed?embed_host=granello&url=${encodeURIComponent(raw)}`, ratio: 0.62 };
  }
  if ((host === "google.com" || host === "maps.google.com") && (path.startsWith("/maps") || host === "maps.google.com")) {
    const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);
    const place = /\/maps\/place\/([^/]+)/.exec(path)?.[1];
    const q = url.searchParams.get("q") ?? (place ? decodeURIComponent(place.replace(/\+/g, " ")) : at ? `${at[1]},${at[2]}` : null);
    return q ? { provider: "Google Maps", src: `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, ratio: 0.6 } : null;
  }
  if (host === "openstreetmap.org") {
    const m = /map=(\d+)\/(-?\d+\.?\d*)\/(-?\d+\.?\d*)/.exec(url.hash);
    if (!m) return null;
    const [zoom, lat, lon] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const span = 360 / 2 ** zoom;
    const box = [lon - span, lat - span / 2, lon + span, lat + span / 2].map((n) => n.toFixed(5)).join(",");
    return { provider: "OpenStreetMap", src: `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${lat},${lon}`, ratio: 0.6 };
  }
  return null;
}

/**
 * Un video, un file Figma o una mappa visibili nella nota. In Markdown resta un link su una
 * riga a sé, marcato dal titolo "embed": `[Titolo](https://… "embed")`.
 * Il contenuto si carica solo quando lo chiedi: aprire la nota non contatta nessun sito.
 */
const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "", parseHTML: (el) => el.getAttribute("data-url") ?? "", renderHTML: (a) => ({ "data-url": a.url }) },
      title: { default: "", parseHTML: (el) => el.getAttribute("data-title") ?? "", renderHTML: (a) => ({ "data-title": a.title }) },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-embed": "" })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h("div", { class: "embed", contentEditable: "false" });
      let current = node;
      let shownUrl: string | null = null;
      let typing = false;
      const position = () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        return typeof pos === "number" ? pos : null;
      };

      const create = (raw: string) => {
        typing = false;
        const pos = position();
        if (pos === null) return;
        const url = raw.trim();
        const source = embedSource(url);
        const tr = editor.view.state.tr;
        if (!source) {
          // un link che non sappiamo incorporare resta un link normale
          if (url) tr.replaceWith(pos, pos + current.nodeSize, editor.schema.nodes.paragraph.create(null, editor.schema.text(url)));
          else tr.delete(pos, pos + current.nodeSize);
        } else {
          tr.setNodeMarkup(pos, undefined, { url, title: source.provider });
        }
        editor.view.dispatch(tr);
      };

      const paint = () => {
        const { url, title } = current.attrs as { url: string; title: string };
        if (!url) {
          if (typing) return;
          typing = true;
          const input = h("input", {
            class: "link-card-input",
            placeholder: t("Incolla un link di YouTube, Loom, Figma, Vimeo o di una mappa"),
            attrs: { "aria-label": t("Indirizzo da incorporare") },
          });
          input.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" && e.key !== "Escape") return;
            e.preventDefault();
            const pos = position();
            const size = current.nodeSize;
            create(e.key === "Enter" ? input.value : "");
            if (pos !== null) backToEditor(editor, pos + size);
          });
          input.addEventListener("blur", () => typing && create(input.value));
          dom.replaceChildren(input);
          if (editor.isEditable) focusSoon(() => input.focus());
          return;
        }
        if (url === shownUrl) return; // già disegnato (e magari già caricato): non si ricomincia
        shownUrl = url;
        const source = embedSource(url);
        if (!source) {
          dom.replaceChildren(h("a", { href: url, class: "embed-fallback" }, title || url));
          return;
        }
        const frame = h("div", { class: "embed-frame", style: `padding-top: ${(source.ratio * 100).toFixed(1)}%` });
        const load = h(
          "button",
          {
            type: "button",
            class: "embed-load",
            on: {
              click: () => {
                frame.replaceChildren(
                  h("iframe", {
                    src: source.src,
                    title: title || source.provider,
                    loading: "lazy",
                    referrerPolicy: "no-referrer",
                    allow: "fullscreen; picture-in-picture",
                    attrs: { sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation" },
                  }),
                );
              },
            },
          },
          h("span", { class: "embed-play" }, "▶"),
          h("span", {}, t("Carica {provider}", { provider: source.provider })),
          h("span", { class: "embed-url" }, url),
        );
        frame.append(load);
        dom.replaceChildren(frame);
      };
      paint();

      return {
        dom,
        update(next) {
          if (next.type.name !== "embed") return false;
          current = next;
          paint();
          return true;
        },
        stopEvent: (e) => dom.contains(e.target as globalThis.Node) && (typing || e.type !== "dragstart"),
        ignoreMutation: () => true,
      };
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: PMNode) {
          const { url, title } = node.attrs as { url: string; title: string };
          if (url) state.write(`[${(title || url).replace(/[[\]\n]/g, " ").trim()}](${url} "embed")`);
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            once(md, "embed", () => {
              replaceParagraphs(md, "embed", (inline) => {
                const c = inline.children ?? [];
                if (c.length !== 3 || c[0].type !== "link_open" || c[1].type !== "text" || c[2].type !== "link_close") return null;
                if (c[0].attrGet("title") !== "embed") return null;
                return `<div data-embed data-url="${escAttr(c[0].attrGet("href") ?? "")}" data-title="${escAttr(c[1].content)}"></div>`;
              });
            });
          },
        },
      },
    };
  },
});

export const embed: EditorPlugin = {
  name: "embed",
  extensions: () => [Embed],
  commands: [
    {
      id: "embed",
      get title() {
        return t("Incorpora");
      },
      get hint() {
        return t("YouTube, Loom, Figma, Vimeo, una mappa");
      },
      icon: "▶",
      get group() {
        return t("Allegati");
      },
      keywords: ["incorpora", "embed", "video", "youtube", "loom", "figma", "vimeo", "mappa", "map"],
      run: (e) => e.chain().focus().insertContent({ type: "embed" }).run(),
    },
  ],
};
