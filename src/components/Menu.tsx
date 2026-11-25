import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Un'azione che non si torna indietro: il primo clic chiede conferma con `confirm`. */
  confirm?: string;
  danger?: boolean;
}

interface Props {
  /** Dove si apre: il punto del clic destro, o l'angolo in basso a destra del pulsante ⋯. */
  at: { x: number; y: number };
  items: MenuItem[];
  label: string;
  onClose: () => void;
}

/**
 * Un menu che si apre sopra la pagina, come quello del clic destro nel Finder: le frecce
 * scorrono le voci, Invio sceglie, Esc o un clic fuori lo chiudono. Una voce da confermare
 * cambia testo al primo clic e agisce al secondo.
 */
export default function Menu({ at, items, label, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [asking, setAsking] = useState<number | null>(null);

  // resta dentro la finestra: vicino al bordo si apre verso sinistra o verso l'alto
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      y: Math.max(8, at.y + height > window.innerHeight - 8 ? at.y - height : at.y),
    });
  }, [at]);

  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("mousedown", away);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const choose = (i: number) => {
    const item = items[i];
    if (item.confirm && asking !== i) {
      setAsking(i);
      return;
    }
    onClose();
    item.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // i tasti restano nel menu: sotto c'è la Libreria, che si muove con le frecce
    e.stopPropagation();
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    const now = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(now + step + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div
      ref={root}
      className="menu"
      role="menu"
      tabIndex={-1}
      aria-label={label}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          role="menuitem"
          className={"menu-item" + (item.danger ? " danger" : "") + (asking === i ? " asking" : "")}
          onClick={() => choose(i)}
        >
          {asking === i ? item.confirm : item.label}
        </button>
      ))}
    </div>
  );
}
