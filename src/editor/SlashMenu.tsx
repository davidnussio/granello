import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { filterCommands } from "./index";
import type { CommandItem } from "./types";

type MenuState = SuggestionProps<CommandItem> | null;

/** Ponte tra il plugin ProseMirror (che vive fuori da React) e il componente del menu. */
export class SlashBridge {
  private listener: (s: MenuState) => void = () => {};
  /** Impostato dal componente: gestisce frecce/invio mentre il menu è aperto. */
  onKeyDown: (e: KeyboardEvent) => boolean = () => false;

  subscribe(fn: (s: MenuState) => void) {
    this.listener = fn;
    return () => {
      this.listener = () => {};
    };
  }
  set(s: MenuState) {
    this.listener(s);
  }
}

/** Estensione TipTap: digitando "/" apre il menu con i comandi offerti dai plugin. */
export function slashExtension(commands: CommandItem[], bridge: SlashBridge) {
  return Extension.create({
    name: "slashMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<CommandItem>({
          editor: this.editor,
          pluginKey: new PluginKey("slashMenu"),
          char: "/",
          allowSpaces: false,
          items: ({ query }) => filterCommands(commands, query),
          allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
          render: () => ({
            onStart: (p) => bridge.set(p),
            onUpdate: (p) => bridge.set(p),
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") {
                bridge.set(null);
                return true;
              }
              return bridge.onKeyDown(event);
            },
            onExit: () => bridge.set(null),
          }),
        }),
      ];
    },
  });
}

const MENU_MAX_HEIGHT = 320;

export function SlashMenu({ bridge }: { bridge: SlashBridge }) {
  const [state, setState] = useState<MenuState>(null);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => bridge.subscribe(setState), [bridge]);

  const items = state?.items ?? [];
  const query = state?.query ?? "";
  // nuova ricerca: si riparte dalla prima voce
  useEffect(() => setSelected(0), [query]);

  bridge.onKeyDown = (e) => {
    if (!state || items.length === 0) return false;
    if (e.key === "ArrowDown") {
      setSelected((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      setSelected((i) => (i - 1 + items.length) % items.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      state.command(items[Math.min(selected, items.length - 1)]);
      return true;
    }
    return false;
  };

  useLayoutEffect(() => {
    list.current?.querySelector(".slash-item.on")?.scrollIntoView({ block: "nearest" });
  }, [selected, items.length]);

  if (!state) return null;
  const rect = state.clientRect?.();
  if (!rect) return null;

  // sotto il cursore, oppure sopra se in basso non c'è spazio
  const below = window.innerHeight - rect.bottom > MENU_MAX_HEIGHT + 16;
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
    ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
    maxHeight: MENU_MAX_HEIGHT,
  };

  let lastGroup = "";
  return createPortal(
    <div className="slash-menu" style={style} ref={list} role="listbox" aria-label="Comandi">
      {items.length === 0 && <div className="slash-empty">Nessun comando per "{query}"</div>}
      {items.map((item, i) => {
        const header = item.group !== lastGroup ? item.group : null;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {header && <div className="slash-group">{header}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              className={"slash-item" + (i === selected ? " on" : "")}
              onMouseEnter={() => setSelected(i)}
              // mousedown: il click toglierebbe il fuoco all'editor chiudendo il menu
              onMouseDown={(e) => {
                e.preventDefault();
                state.command(item);
              }}
            >
              <span className="slash-icon">{item.icon}</span>
              <span className="slash-title">{item.title}</span>
              {item.hint && <span className="slash-hint">{item.hint}</span>}
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
