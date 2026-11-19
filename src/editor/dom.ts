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
