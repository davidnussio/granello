import { dataBlock, type BlockView } from "../dataBlock";
import { h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

type Point = [number, number];
interface Stroke {
  color: string;
  size: number;
  points: Point[];
}
interface Sketch {
  width: number;
  height: number;
  strokes: Stroke[];
}

const SVG = "http://www.w3.org/2000/svg";
const SIZE = { width: 680, height: 320 };
/** "ink" segue il tema (scuro su chiaro, chiaro su scuro); gli altri sono colori fissi. */
const COLORS: Record<string, string> = { ink: "var(--text)", red: "#d64545", green: "#4a9c63", blue: "#3f7fbf" };
const colorOf = (name: string) => COLORS[name] ?? COLORS.ink;

function polyline(stroke: Stroke): SVGElement {
  const line = document.createElementNS(SVG, "polyline");
  // un solo punto non si vedrebbe: diventa un trattino minimo
  const points = stroke.points.length === 1 ? [stroke.points[0], [stroke.points[0][0] + 0.1, stroke.points[0][1]]] : stroke.points;
  line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", colorOf(stroke.color));
  line.setAttribute("stroke-width", String(stroke.size));
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  return line;
}

function render(view: BlockView<Sketch>) {
  const { data } = view;
  const color = (view.local.color as string | undefined) ?? "ink";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${data.width} ${data.height}`);
  svg.setAttribute("class", "sketch-canvas");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", t("Schizzo"));
  svg.append(...data.strokes.map(polyline));

  let drawing: { stroke: Stroke; line: SVGElement } | null = null;
  const at = (e: PointerEvent): Point => {
    const box = svg.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, v)));
    return [
      clamp(((e.clientX - box.left) / box.width) * data.width, data.width),
      clamp(((e.clientY - box.top) / box.height) * data.height, data.height),
    ];
  };
  svg.addEventListener("pointerdown", (e) => {
    if (!view.editor.isEditable || e.button !== 0) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const stroke: Stroke = { color, size: 2.5, points: [at(e)] };
    drawing = { stroke, line: polyline(stroke) };
    svg.append(drawing.line);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const point = at(e);
    const last = drawing.stroke.points[drawing.stroke.points.length - 1];
    // i punti troppo vicini appesantiscono la nota senza cambiare il tratto
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 2) return;
    drawing.stroke.points.push(point);
    drawing.line.setAttribute("points", drawing.stroke.points.map((p) => p.join(",")).join(" "));
  });
  const finish = () => {
    if (!drawing) return;
    const { stroke } = drawing;
    drawing = null;
    view.set({ ...data, strokes: [...data.strokes, stroke] });
  };
  svg.addEventListener("pointerup", finish);
  svg.addEventListener("pointercancel", finish);

  view.dom.replaceChildren(
    h(
      "div",
      { class: "sketch-tools" },
      ...Object.keys(COLORS).map((name) =>
        h(
          "button",
          {
            type: "button",
            class: "sketch-color" + (name === color ? " on" : ""),
            title: t("Colore del tratto"),
            style: `background: ${colorOf(name)}`,
            attrs: { "aria-pressed": String(name === color) },
            on: {
              click: () => {
                view.local.color = name;
                render(view);
              },
            },
          },
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: "block-add",
          disabled: data.strokes.length === 0,
          on: { click: () => view.set({ ...data, strokes: data.strokes.slice(0, -1) }) },
        },
        t("Annulla tratto"),
      ),
      h(
        "button",
        { type: "button", class: "block-add", disabled: data.strokes.length === 0, on: { click: () => view.set({ ...data, strokes: [] }) } },
        t("Pulisci"),
      ),
    ),
    svg as unknown as HTMLElement,
  );
}

/**
 * Lavagna per uno schizzo a mano libera. In Markdown è un blocco di codice `sketch`: la prima
 * riga dà le dimensioni, ogni riga successiva è un tratto (colore, spessore, punti).
 */
const SketchBlock = dataBlock<Sketch>({
  name: "sketch",
  tag: "sketch",
  empty: { ...SIZE, strokes: [] },
  format: {
    kind: "fence",
    parse: (code) => {
      const [first = "", ...rest] = code.split("\n");
      const size = /^(\d{2,4})x(\d{2,4})$/.exec(first.trim());
      const lines = size ? rest : [first, ...rest];
      return {
        width: size ? Number(size[1]) : SIZE.width,
        height: size ? Number(size[2]) : SIZE.height,
        strokes: lines.flatMap((line) => {
          const [color, width, ...pairs] = line.trim().split(/\s+/);
          const points = pairs
            .map((p) => p.split(",").map(Number))
            .filter((p): p is Point => p.length === 2 && p.every(Number.isFinite));
          return color && points.length ? [{ color, size: Number(width) || 2.5, points }] : [];
        }),
      };
    },
    write: (data) =>
      [`${data.width}x${data.height}`, ...data.strokes.map((s) => `${s.color} ${s.size} ${s.points.map((p) => p.join(",")).join(" ")}`)].join("\n"),
  },
  render,
});

export const sketch: EditorPlugin = {
  name: "sketch",
  extensions: () => [SketchBlock],
  commands: [
    {
      id: "sketch",
      get title() {
        return t("Lavagna");
      },
      get hint() {
        return t("Uno schizzo a mano libera");
      },
      icon: "✎",
      get group() {
        return t("Strumenti");
      },
      keywords: ["lavagna", "schizzo", "disegno", "whiteboard", "sketch", "draw", "mano libera"],
      run: (e) => e.chain().focus().insertContent({ type: "sketch" }).run(),
    },
  ],
};
