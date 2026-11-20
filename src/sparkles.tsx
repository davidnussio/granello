import { Fragment, type ReactNode } from "react";

/**
 * Il segno dell'AI in tutta l'app: tre stelline, una grande e due piccole. Nei testi si scrive
 * ancora "✦" (anche nelle traduzioni): `sparkle()` lo sostituisce con l'icona quando si disegna.
 */

/** Una stella a quattro punte con i lati incurvati, centrata in (x, y) e di raggio r. */
function star(x: number, y: number, r: number): string {
  const k = r * 0.22;
  return `M${x} ${y - r}C${x + k} ${y - k} ${x + k} ${y - k} ${x + r} ${y}C${x + k} ${y + k} ${x + k} ${y + k} ${x} ${y + r}C${x - k} ${y + k} ${x - k} ${y + k} ${x - r} ${y}C${x - k} ${y - k} ${x - k} ${y - k} ${x} ${y - r}Z`;
}

const PATHS = [star(10, 13.5, 8.5), star(18.8, 5.2, 4), star(19.5, 19, 2.8)];

export function Sparkles() {
  return (
    <svg className="sparkles" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Il testo con ogni "✦" sostituito dall'icona. */
export function sparkle(text: string): ReactNode {
  if (!text.includes("✦")) return text;
  return text.split("✦").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <Sparkles />}
      {part}
    </Fragment>
  ));
}

/** L'icona come elemento, per i blocchi dell'editor scritti senza React. */
export function sparklesEl(): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "sparkles");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PATHS) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** Come `sparkle()`, ma in nodi DOM: da passare come figli a `h()`. */
export function sparkleNodes(text: string): (Node | string)[] {
  return text.split("✦").flatMap((part, i) => (i > 0 ? [sparklesEl(), part] : [part])).filter((n) => n !== "");
}
