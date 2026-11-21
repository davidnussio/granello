import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { h } from "./dom";

/**
 * Maniglie dei blocchi fatti di celle (le tabelle, le colonne): piccoli pulsanti che compaiono
 * sopra il blocco quando ci passa il puntatore o c'è dentro il cursore, e aprono un menu con le
 * azioni su una riga, una colonna o tutto il blocco. Stanno in un livello accanto al testo,
 * fuori dal contenuto modificabile: non finiscono nella nota né nel Markdown.
 */

/** Voce del menu di una maniglia; "sep" è un separatore. */
export type MenuEntry = { label: string; danger?: boolean; run: () => void } | "sep";

/** Posizione e misura rispetto al livello delle maniglie. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HandleContext {
  /** Il blocco sotto il puntatore, o quello che contiene il cursore. */
  block: HTMLElement;
  /** La cella di quel blocco su cui agire, se ce n'è una. */
  cell: HTMLElement | null;
  box(el: Element): Box;
  /** Maniglia che apre un menu. */
  grip(props: { class: string; title: string; at: Box; menu: () => MenuEntry[] }): HTMLElement;
  /** Pulsante con un'azione sola. */
  button(props: { class: string; title: string; at: Box; label: string; run: () => void }): HTMLElement;
}

export interface HandleSpec {
  name: string;
  /** Selettore CSS del blocco e delle sue celle. */
  block: string;
  cell: string;
  draw(ctx: HandleContext): HTMLElement[];
}

interface Target {
  block: HTMLElement;
  cell: HTMLElement | null;
}

/** Quanto ci si può allontanare dal blocco senza che le maniglie spariscano: serve a raggiungerle. */
const REACH = 26;

const place = (el: HTMLElement, at: Box) => {
  el.style.left = `${at.left}px`;
  el.style.top = `${at.top}px`;
  el.style.width = `${at.width}px`;
  el.style.height = `${at.height}px`;
  return el;
};

// si agisce al mousedown, senza togliere il fuoco all'editor: il cursore resta dov'è
const press = (run: (el: HTMLElement) => void) => (e: MouseEvent) => {
  if (e.button !== 0) return;
  e.preventDefault();
  run(e.currentTarget as HTMLElement);
};

class HandlesView {
  private layer = h("div", { class: "handles", attrs: { contenteditable: "false" } });
  private host: HTMLElement | null = null;
  private hover: Target | null = null;
  private menu: HTMLElement | null = null;
  private frame = 0;
  private resize = new ResizeObserver(() => this.schedule());

  constructor(
    private view: EditorView,
    private spec: HandleSpec,
  ) {
    view.dom.addEventListener("focus", this.schedule);
    view.dom.addEventListener("blur", this.schedule);
    this.resize.observe(view.dom);
    this.schedule();
  }

  update() {
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.closeMenu();
    this.resize.disconnect();
    this.view.dom.removeEventListener("focus", this.schedule);
    this.view.dom.removeEventListener("blur", this.schedule);
    this.leaveHost();
    this.layer.remove();
  }

  private schedule = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paint());
  };

  /** L'editor viene spostato nella pagina dopo essere stato creato: il livello lo segue. */
  private attach(): boolean {
    const host = this.view.dom.parentElement;
    if (!host?.isConnected) return false;
    if (host !== this.host) {
      this.leaveHost();
      this.host = host;
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.addEventListener("mousemove", this.onMove);
      host.addEventListener("mouseleave", this.onLeave);
    }
    if (this.layer.parentElement !== host) host.append(this.layer);
    return true;
  }

  private leaveHost() {
    this.host?.removeEventListener("mousemove", this.onMove);
    this.host?.removeEventListener("mouseleave", this.onLeave);
    this.host = null;
  }

  private pick(el: Element | null): Target | null {
    if (!el || !this.view.dom.contains(el)) return null;
    const cell = el.closest<HTMLElement>(this.spec.cell);
    const block = (cell ?? el).closest<HTMLElement>(this.spec.block);
    if (!block || !this.view.dom.contains(block)) return null;
    return { block, cell: cell && block.contains(cell) ? cell : null };
  }

  private fromSelection(): Target | null {
    if (!this.view.hasFocus()) return null;
    const { node } = this.view.domAtPos(this.view.state.selection.from);
    return this.pick(node instanceof Element ? node : node.parentElement);
  }

  private setHover(next: Target | null) {
    if (next?.block === this.hover?.block && next?.cell === this.hover?.cell) return;
    this.hover = next;
    this.schedule();
  }

  private onMove = (e: MouseEvent) => {
    const el = e.target as Element;
    if (this.layer.contains(el)) return;
    const found = this.pick(el);
    if (found) {
      // tra una cella e l'altra (un bordo) resta la cella di prima
      const cell = found.cell ?? (this.hover?.block === found.block ? this.hover.cell : null);
      this.setHover({ block: found.block, cell });
      return;
    }
    if (!this.hover) return;
    const r = this.hover.block.getBoundingClientRect();
    const near =
      e.clientX >= r.left - REACH &&
      e.clientX <= r.right + REACH &&
      e.clientY >= r.top - REACH &&
      e.clientY <= r.bottom + REACH;
    if (!near) this.setHover(null);
  };

  private onLeave = () => this.setHover(null);

  private paint() {
    // con il menu aperto le maniglie restano dove sono: il menu è legato a una di loro
    if (this.menu) return;
    if (!this.attach() || !this.view.editable) {
      this.layer.replaceChildren();
      return;
    }
    if (this.hover && !this.hover.block.isConnected) this.hover = null;
    if (this.hover?.cell && !this.hover.cell.isConnected) this.hover.cell = null;
    const target = this.hover ?? this.fromSelection();
    if (!target) {
      this.layer.replaceChildren();
      return;
    }
    const origin = this.host!.getBoundingClientRect();
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
    };
    const ctx: HandleContext = {
      ...target,
      box,
      grip: ({ class: cls, title, at, menu }) =>
        place(
          h("button", {
            type: "button",
            class: `handle handle-grip ${cls}`,
            title,
            tabIndex: -1,
            attrs: { "aria-label": title, "aria-haspopup": "menu" },
            on: { mousedown: press((el) => this.openMenu(el, menu())) },
          }),
          at,
        ),
      button: ({ class: cls, title, at, label, run }) =>
        place(
          h(
            "button",
            {
              type: "button",
              class: `handle ${cls}`,
              title,
              tabIndex: -1,
              attrs: { "aria-label": title },
              on: { mousedown: press(run) },
            },
            label,
          ),
          at,
        ),
    };
    this.layer.replaceChildren(...this.spec.draw(ctx));
  }

  private openMenu(anchor: HTMLElement, entries: MenuEntry[]) {
    this.closeMenu();
    const menu = h(
      "div",
      { class: "block-menu", attrs: { role: "menu" } },
      ...entries.map((entry) =>
        entry === "sep"
          ? h("div", { class: "block-menu-sep" })
          : h(
              "button",
              {
                type: "button",
                class: "block-menu-item" + (entry.danger ? " danger" : ""),
                attrs: { role: "menuitem" },
                on: {
                  mousedown: (e) => {
                    e.preventDefault();
                    this.closeMenu();
                    entry.run();
                  },
                },
              },
              entry.label,
            ),
      ),
    );
    document.body.append(menu);
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.left, window.innerWidth - m.width - 8));
    const below = a.bottom + 4;
    const top = below + m.height > window.innerHeight - 8 ? Math.max(8, a.top - m.height - 4) : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    anchor.classList.add("open");
    this.menu = menu;
    document.addEventListener("mousedown", this.onOutside, true);
    document.addEventListener("keydown", this.onKey, true);
    document.addEventListener("scroll", this.closeMenu, true);
    window.addEventListener("blur", this.closeMenu);
  }

  private closeMenu = () => {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    document.removeEventListener("mousedown", this.onOutside, true);
    document.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("scroll", this.closeMenu, true);
    window.removeEventListener("blur", this.closeMenu);
    this.schedule();
  };

  private onOutside = (e: MouseEvent) => {
    if (!this.menu?.contains(e.target as Node)) this.closeMenu();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    this.closeMenu();
  };
}

/** Plugin ProseMirror che disegna le maniglie descritte da `spec`. */
export function handles(spec: HandleSpec): Plugin {
  return new Plugin({
    key: new PluginKey(`handles-${spec.name}`),
    view: (view) => new HandlesView(view, spec),
  });
}
