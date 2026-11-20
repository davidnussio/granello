import { t } from "../i18n";
import { sparkle } from "../sparkles";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { filterCommands } from "./index";
import type { CommandItem, SuggestMenu } from "./types";

type MenuState = SuggestionProps<CommandItem> | null;

/** Ponte tra il plugin ProseMirror (che vive fuori da React) e il componente del menu. */
export class SlashBridge implements SuggestMenu {
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

/** Un comando è "di contesto" se tutto il suo gruppo compare solo in certe situazioni. */
function isContextGroup(item: CommandItem, all: CommandItem[]): boolean {
  return !!item.when && all.filter((c) => c.group === item.group).every((c) => c.when);
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
          items: ({ query, editor }) => {
            // i comandi legati al contesto (es. quelli della tabella) stanno in cima
            const available = commands.filter((c) => !c.when || c.when(editor));
            const context = available.filter((c) => isContextGroup(c, commands));
            return filterCommands([...context, ...available.filter((c) => !context.includes(c))], query);
          },
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
/** Largo quanto basta perché titolo e suggerimento stiano su una riga. */
const MENU_WIDTH = 420;

export function SlashMenu({ bridge }: { bridge: SlashBridge }) {
  const [state, setState] = useState<MenuState>(null);
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  /** Dove si trovava il mouse l'ultima volta che si è mosso davvero. */
  const pointer = useRef({ x: -1, y: -1 });

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
    left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
    width: MENU_WIDTH,
    maxWidth: "calc(100vw - 16px)",
    ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
    maxHeight: MENU_MAX_HEIGHT,
  };

  let lastGroup = "";
  return createPortal(
    <div className="slash-menu" style={style} ref={list} role="listbox" aria-label={t("Comandi")}>
      {items.length === 0 && (
        <div className="slash-empty">{t('Nessun comando per "{query}"', { query })}</div>
      )}
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
              // un suggerimento lungo viene troncato: passandoci sopra si legge intero
              title={item.hint}
              // Solo un movimento vero del mouse sceglie la voce. Quando le frecce fanno scorrere
              // l'elenco, la voce che finisce sotto il mouse fermo riceve gli stessi eventi:
              // senza questo controllo la selezione saltava lì, a metà elenco.
              onMouseMove={(e) => {
                if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) return;
                pointer.current = { x: e.clientX, y: e.clientY };
                setSelected(i);
              }}
              // mousedown: il click toglierebbe il fuoco all'editor chiudendo il menu
              onMouseDown={(e) => {
                e.preventDefault();
                state.command(item);
              }}
            >
              <span className="slash-icon">{sparkle(item.icon)}</span>
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
