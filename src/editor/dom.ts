/** Costruisce un elemento DOM: i blocchi dell'editor con una loro interfaccia sono scritti senza React. */
type Child = globalThis.Node | string | number | null | undefined | false;

interface Props {
  class?: string;
  style?: string;
  /** Attributi HTML (data-*, aria-*, …). */
  attrs?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
  [property: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === "class") el.className = value as string;
    else if (key === "style") el.style.cssText = value as string;
    else if (key === "attrs") for (const [a, v] of Object.entries(value as Record<string, string>)) el.setAttribute(a, v);
    else if (key === "on") {
      for (const [type, fn] of Object.entries(value as Record<string, EventListener>)) el.addEventListener(type, fn);
    } else (el as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "number" ? String(child) : child);
  }
  return el;
}

/** Campo di testo che conferma con Invio o uscendo, e ripristina con Esc. */
export function field(
  value: string,
  onCommit: (value: string) => void,
  props: Props & { onEnter?: (value: string) => void } = {},
): HTMLInputElement {
  const { onEnter, ...rest } = props;
  const input = h("input", { type: "text", value, ...rest });
  let done = false;
  const commit = () => {
    if (done || input.value === value) return;
    done = true;
    onCommit(input.value);
  };
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (onEnter) {
        done = true;
        onEnter(input.value);
      } else input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = value;
      input.blur();
    }
  });
  return input;
}

/**
 * Campo di testo su più righe che cresce con il contenuto. Come `field`: conferma con Invio
 * o uscendo, ripristina con Esc. Il testo resta una riga sola: gli a capo sono solo visivi.
 */
export function area(value: string, onCommit: (value: string) => void, props: Props = {}): HTMLTextAreaElement {
  const text = h("textarea", { rows: 1, value, ...props });
  const fit = () => {
    text.style.height = "auto";
    text.style.height = `${text.scrollHeight}px`;
  };
  text.addEventListener("input", fit);
  text.addEventListener("blur", () => {
    const next = text.value.replace(/\s+/g, " ").trim();
    if (next !== value) onCommit(next);
  });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      text.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      text.value = value;
      text.blur();
    }
  });
  // l'altezza si può misurare solo quando il campo è nella pagina
  requestAnimationFrame(fit);
  return text;
}
