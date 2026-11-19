import { t } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import Link from "@tiptap/extension-link";
import type { Editor } from "@tiptap/react";
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

export const links: EditorPlugin = {
  name: "links",
  extensions: () => [
    Link.configure({
      // l'apertura è gestita a livello di app: ⌘+click apre nel browser
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      protocols: ["http", "https", "mailto"],
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
