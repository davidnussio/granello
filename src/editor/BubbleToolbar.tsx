import { useEffect, useState } from "react";
import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import type { ToolbarItem } from "./types";
import { sparkle } from "../sparkles";

/** Barra di formattazione che compare sopra il testo selezionato. I pulsanti arrivano dai plugin. */
export default function BubbleToolbar({ editor, items }: { editor: Editor; items: ToolbarItem[] }) {
  const [panelId, setPanelId] = useState<string | null>(null);
  const panelItem = items.find((i) => i.id === panelId && i.panel);

  // cambiando selezione si torna ai pulsanti
  const { from, to } = editor.state.selection;
  useEffect(() => setPanelId(null), [from, to]);

  if (items.length === 0) return null;
  let lastGroup = items[0].group;

  return (
    <BubbleMenu
      editor={editor}
      className="bubble-toolbar"
      tippyOptions={{ duration: 120, maxWidth: "none", onHidden: () => setPanelId(null) }}
      shouldShow={({ editor: ed, state, element }) => {
        const inMenu = element.contains(document.activeElement);
        if (!ed.isEditable || (!ed.isFocused && !inMenu)) return false;
        return !state.selection.empty && !ed.isActive("codeBlock");
      }}
    >
      {panelItem?.panel ? (
        <panelItem.panel editor={editor} close={() => setPanelId(null)} />
      ) : (
        items.map((item) => {
          const sep = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <span key={item.id} className="tb-slot">
              {sep && <span className="tb-sep" />}
              <button
                type="button"
                className={"tb-btn " + (item.className ?? "") + (item.isActive?.(editor) ? " on" : "")}
                title={item.title}
                aria-label={item.title}
                aria-pressed={item.isActive?.(editor) ?? false}
                // mousedown + preventDefault: la selezione nel testo non va persa
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (item.panel) setPanelId(item.id);
                  else item.run?.(editor);
                }}
              >
                {sparkle(item.label)}
              </button>
            </span>
          );
        })
      )}
    </BubbleMenu>
  );
}
