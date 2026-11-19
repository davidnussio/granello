import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

export interface ChipSuggestion {
  value: string;
  /** Testo secondario (es. email, numero di meeting). */
  hint?: string;
  /** Etichetta che indica da dove arriva la proposta (es. "dal calendario"). */
  badge?: string;
}

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  /** Proposte per il testo digitato; quelle già presenti vengono tolte dall'elenco. */
  suggest: (query: string) => Promise<ChipSuggestion[]>;
  /** Etichetta del pulsante che apre il campo (es. "+ Partecipante"). */
  addLabel: string;
  placeholder: string;
  /** Prefisso mostrato davanti a ogni valore (es. "#" per i tag). */
  prefix?: string;
  chipClass?: string;
  /** Ripulisce il testo digitato prima di aggiungerlo. */
  normalize?: (raw: string) => string;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Elenco modificabile di "chip" con completamento automatico: usato per partecipanti e tag. */
export default function ChipInput(p: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<ChipSuggestion[]>([]);
  const [selected, setSelected] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const clean = (raw: string) => (p.normalize ? p.normalize(raw) : raw.trim().replace(/\s+/g, " "));

  // proposte aggiornate mentre si scrive; le risposte arrivate in ritardo vengono scartate
  useEffect(() => {
    if (!adding) return;
    const mine = ++requestId.current;
    const timer = setTimeout(() => {
      p.suggest(text.trim())
        .then((list) => {
          if (mine !== requestId.current) return;
          setItems(list.filter((s) => !p.values.some((v) => same(v, s.value))));
          setSelected(-1);
        })
        .catch(() => {});
    }, 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, adding, p.values.join("\u0000")]);

  const add = (raw: string) => {
    const value = clean(raw);
    setText("");
    if (!value || p.values.some((v) => same(v, value))) return;
    p.onChange([...p.values, value]);
  };

  const remove = (value: string) => p.onChange(p.values.filter((v) => v !== value));

  const close = () => {
    setAdding(false);
    setText("");
    setItems([]);
  };

  return (
    <span className="chip-input">
      {p.values.map((v) => (
        <span key={v} className={"chip " + (p.chipClass ?? "")}>
          {p.prefix}
          {v}
          <button
            type="button"
            className="chip-x"
            aria-label={t("Rimuovi {name}", { name: v })}
            title={t("Rimuovi {name}", { name: v })}
            onClick={() => remove(v)}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <span className="chip-field">
          <input
            ref={input}
            autoFocus
            value={text}
            placeholder={p.placeholder}
            aria-label={p.placeholder}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              // scrivere e cliccare altrove conferma, come ci si aspetta da un campo di tag
              if (text.trim()) add(text);
              close();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && items.length) {
                e.preventDefault();
                setSelected((i) => (i + 1) % items.length);
              } else if (e.key === "ArrowUp" && items.length) {
                e.preventDefault();
                setSelected((i) => (i <= 0 ? items.length - 1 : i - 1));
              } else if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
                if (e.key === "Tab" && !text.trim() && selected < 0) return; // Tab a vuoto: esce dal campo
                e.preventDefault();
                add(selected >= 0 ? items[selected].value : text);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setText("");
                input.current?.blur();
              } else if (e.key === "Backspace" && !text && p.values.length) {
                p.onChange(p.values.slice(0, -1));
              }
            }}
          />
          {items.length > 0 && (
            <span className="chip-menu" role="listbox">
              {items.map((s, i) => (
                <button
                  key={s.value}
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  className={"chip-option" + (i === selected ? " on" : "")}
                  onMouseEnter={() => setSelected(i)}
                  // mousedown: il click farebbe perdere il fuoco al campo prima di aggiungere
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(s.value);
                  }}
                >
                  <span className="chip-option-name">
                    {p.prefix}
                    {s.value}
                  </span>
                  {s.hint && <span className="chip-option-hint">{s.hint}</span>}
                  {s.badge && <span className="chip tiny">{s.badge}</span>}
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <button type="button" className="chip add" onClick={() => setAdding(true)}>
          {p.addLabel}
        </button>
      )}
    </span>
  );
}
