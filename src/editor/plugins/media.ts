import { Node, mergeAttributes } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { api, errorText, notify, type Attachment } from "../../api";
import { t } from "../../i18n";
import type { MdState } from "../markdown";
import type { EditorPlugin } from "../types";

/** Oltre questa dimensione un file non viene copiato tra gli allegati. */
const MAX_BYTES = 25 * 1024 * 1024;

const isAttachment = (src: string) => src.startsWith("attachments/");

/** Le immagini allegate arrivano dal backend come data URL: una lettura sola per file. */
const loaded = new Map<string, Promise<string>>();
function resolve(src: string): Promise<string> {
  if (src.startsWith("data:image/")) return Promise.resolve(src);
  // niente immagini da Internet: la nota non deve contattare nessuno quando la apri
  if (!isAttachment(src)) return Promise.reject(new Error("remote"));
  let p = loaded.get(src);
  if (!p) {
    p = api.readAttachment(src);
    loaded.set(src, p);
    p.catch(() => loaded.delete(src));
  }
  return p;
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function base64(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => fail(reader.error), { once: true });
    reader.addEventListener("load", () => ok(String(reader.result).replace(/^data:[^,]*,/, "")), {
      once: true,
    });
    reader.readAsDataURL(file);
  });
}

/** Il contenuto da inserire per un allegato: l'immagine, oppure un link al file. */
function contentFor(a: Attachment, image: boolean) {
  if (image) return { type: "image", attrs: { src: a.path, alt: a.name } };
  return [
    {
      type: "text",
      text: `📎 ${a.name} (${sizeLabel(a.size)})`,
      marks: [{ type: "link", attrs: { href: a.path } }],
    },
    { type: "text", text: " " },
  ];
}

/** Copia i file tra gli allegati e li inserisce nella nota (alla posizione data, o al cursore). */
async function insertFiles(editor: Editor, files: File[], pos?: number) {
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      notify(t("{name} è troppo grande: al massimo 25 MB.", { name: file.name }));
      continue;
    }
    try {
      const saved = await api.saveAttachment(file.name || "immagine.png", await base64(file));
      const content = contentFor(saved, file.type.startsWith("image/"));
      if (pos === undefined) editor.chain().focus().insertContent(content).run();
      else editor.chain().focus().insertContentAt(pos, content).run();
    } catch (e) {
      notify(errorText(e));
    }
  }
}

async function pick(editor: Editor, imagesOnly: boolean) {
  try {
    const picked = await api.pickAttachment(imagesOnly);
    if (picked) editor.chain().focus().insertContent(contentFor(picked, imagesOnly)).run();
  } catch (e) {
    notify(errorText(e));
  }
}

/** Immagine nella nota. In Markdown: `![descrizione](attachments/…)`. */
const Image = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: "" }, alt: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes)];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("figure");
      dom.className = "note-image";
      const img = document.createElement("img");
      img.draggable = false;
      let shown = "";
      const show = (n: PMNode) => {
        const src: string = n.attrs.src;
        img.alt = n.attrs.alt;
        if (src === shown) return;
        shown = src;
        resolve(src).then(
          (url) => {
            if (shown !== src) return;
            img.src = url;
            dom.replaceChildren(img);
          },
          () => {
            if (shown !== src) return;
            dom.classList.add("missing");
            dom.textContent = isAttachment(src)
              ? t("Immagine non trovata: {name}", { name: n.attrs.alt || src })
              : t("Immagine esterna non caricata: {name}", { name: n.attrs.alt || src });
          },
        );
      };
      show(node);
      return {
        dom,
        update(next) {
          if (next.type.name !== "image") return false;
          show(next);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("attachments"),
        props: {
          handlePaste(_view, event) {
            const files = [...(event.clipboardData?.files ?? [])];
            // copiando da una pagina o da un documento arriva anche un'immagine del testo: lì vince il testo
            if (!files.length || event.clipboardData?.getData("text/plain")) return false;
            event.preventDefault();
            insertFiles(editor, files);
            return true;
          },
          handleDrop(view, event, _slice, moved) {
            const files = [...(event.dataTransfer?.files ?? [])];
            if (moved || !files.length) return false;
            event.preventDefault();
            insertFiles(editor, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
            return true;
          },
        },
      }),
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MdState & { inTightList?: boolean }, node: PMNode, parent: PMNode, index: number) {
          const alt = String(node.attrs.alt)
            .replace(/[[\]\n]/g, " ")
            .trim();
          // `- testo` e sotto `  ![](…)`: in un elenco compatto l'immagine sta a capo, senza righe
          // vuote prima o dopo il testo (o le altre immagini) dello stesso elemento. Con una riga
          // vuota l'elenco si rileggerebbe largo, e al salvataggio dopo si aggiungerebbe una riga
          // vuota tra gli elementi. Riletta, l'immagine torna comunque un blocco a sé.
          const tight = state.inTightList && parent.type.name === "listItem";
          const isText = (i: number) =>
            i >= 0 && i < parent.childCount && ["paragraph", "image"].includes(parent.child(i).type.name);
          if (tight && isText(index - 1)) state.flushClose(1);
          state.write(`![${alt}](${node.attrs.src})`);
          if (tight && isText(index + 1)) state.ensureNewLine();
          else state.closeBlock(node);
        },
      },
    };
  },
});

export const media: EditorPlugin = {
  name: "media",
  extensions: () => [Image],
  commands: [
    {
      id: "image",
      get title() {
        return t("Immagine");
      },
      get hint() {
        return t("Oppure incolla uno screenshot");
      },
      icon: "▣",
      get group() {
        return t("Allegati");
      },
      keywords: ["immagine", "image", "foto", "screenshot", "figura"],
      run: (e) => void pick(e, true),
    },
    {
      id: "attachment",
      get title() {
        return t("Allegato");
      },
      get hint() {
        return t("Un file collegato alla nota");
      },
      icon: "📎",
      get group() {
        return t("Allegati");
      },
      keywords: ["allegato", "file", "attachment", "documento", "pdf"],
      run: (e) => void pick(e, false),
    },
  ],
};
