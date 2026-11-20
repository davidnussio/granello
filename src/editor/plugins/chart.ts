import type { Node as PMNode } from "@tiptap/pm/model";
import { dataBlock, type BlockView } from "../dataBlock";
import { h } from "../dom";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Chart {
  kind: "bar" | "line";
}

interface Series {
  name: string;
  values: (number | null)[];
}

interface TableData {
  categories: string[];
  series: Series[];
}

const COLORS = ["#4a7c59", "#5d6a8a", "#d08a2e", "#b5527a", "#3f8fa8", "#8a6fb0"];
const SVG = "http://www.w3.org/2000/svg";

/** "1'200,50", "12.5 %", "CHF 3.000" → numero; null se la cella non è un numero. */
export function toNumber(text: string): number | null {
  let s = text.replace(/[^\d.,\-−]/g, "").replace("−", "-");
  if (!/\d/.test(s)) return null;
  // un solo separatore seguito da tre cifre è delle migliaia: "1.500" e "1,500" valgono 1500
  if (/^-?[1-9]\d{0,2}[.,]\d{3}$/.test(s)) s = s.replace(/[.,]/, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // l'ultimo dei due è il separatore decimale, l'altro quello delle migliaia
    s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (comma >= 0) {
    s = s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** La tabella più vicina prima del grafico: prima colonna = categorie, le altre = serie numeriche. */
export function tableBefore(doc: PMNode, pos: number): TableData | null {
  let table: PMNode | null = null;
  doc.descendants((node, at) => {
    if (at >= pos) return false;
    if (node.type.name === "table") table = node;
    return true;
  });
  if (!table) return null;
  const rows: string[][] = [];
  (table as PMNode).forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent.trim()));
    rows.push(cells);
  });
  const [head, ...body] = rows;
  if (!head || body.length === 0) return null;
  const series = head
    .slice(1)
    .map((name, i) => ({ name: name || `${i + 1}`, values: body.map((r) => toNumber(r[i + 1] ?? "")) }))
    .filter((s) => s.values.some((v) => v !== null));
  return series.length ? { categories: body.map((r) => r[0] ?? ""), series } : null;
}

function el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

const show = (n: number) =>
  Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 100) / 100);

function draw(data: TableData, kind: Chart["kind"]): SVGElement {
  const W = 680;
  const H = 240;
  const m = { top: 12, right: 12, bottom: 30, left: 44 };
  const values = data.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;
  const y = (v: number) => m.top + innerH - ((v - min) / span) * innerH;
  const band = innerW / data.categories.length;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img" });
  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    svg.append(
      el("line", { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v), class: "chart-grid" }),
      el("text", { x: m.left - 6, y: y(v) + 4, "text-anchor": "end", class: "chart-tick" }, show(v)),
    );
  }
  data.categories.forEach((label, i) => {
    const text = label.length > 14 ? `${label.slice(0, 13)}…` : label;
    svg.append(
      el(
        "text",
        { x: m.left + band * (i + 0.5), y: H - 10, "text-anchor": "middle", class: "chart-tick" },
        text,
      ),
    );
  });

  data.series.forEach((s, si) => {
    const color = COLORS[si % COLORS.length];
    if (kind === "bar") {
      const width = (band * 0.72) / data.series.length;
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = m.left + band * i + band * 0.14 + width * si;
        const bar = el("rect", {
          x,
          y: Math.min(y(v), y(0)),
          width: Math.max(1, width - 2),
          height: Math.max(1, Math.abs(y(v) - y(0))),
          rx: 2,
          fill: color,
        });
        bar.append(el("title", {}, `${s.name} · ${data.categories[i]}: ${v}`));
        svg.append(bar);
      });
    } else {
      const points = s.values.map((v, i) =>
        v === null ? null : ([m.left + band * (i + 0.5), y(v)] as const),
      );
      const path = points
        .filter((p) => p !== null)
        .map((p) => p!.join(","))
        .join(" ");
      svg.append(
        el("polyline", {
          points: path,
          fill: "none",
          stroke: color,
          "stroke-width": 2,
          "stroke-linejoin": "round",
        }),
      );
      points.forEach((p, i) => {
        if (!p) return;
        const dot = el("circle", { cx: p[0], cy: p[1], r: 3.5, fill: color });
        dot.append(el("title", {}, `${s.name} · ${data.categories[i]}: ${s.values[i]}`));
        svg.append(dot);
      });
    }
  });
  return svg;
}

function render(view: BlockView<Chart>) {
  if (!view.local.subscribed) {
    view.local.subscribed = true;
    const refresh = () => render(view);
    view.editor.on("update", refresh);
    view.cleanup.push(() => view.editor.off("update", refresh));
  }
  const pos = view.pos();
  const data = pos === null ? null : tableBefore(view.editor.state.doc, pos);
  const kind = view.data.kind;
  const signature = JSON.stringify([kind, data]);
  if (view.local.shown === signature) return;
  view.local.shown = signature;

  if (!data) {
    view.dom.replaceChildren(
      h(
        "span",
        { class: "chart-empty" },
        t("Il grafico disegna la tabella che lo precede: prima colonna le voci, le altre i numeri."),
      ),
    );
    return;
  }
  view.dom.replaceChildren(
    h(
      "div",
      { class: "chart-head" },
      ...data.series.map((s, i) =>
        h(
          "span",
          { class: "chart-legend" },
          h("span", { class: "chart-swatch", style: `background: ${COLORS[i % COLORS.length]}` }),
          s.name,
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: "block-add chart-kind",
          title: t("Cambia tipo di grafico"),
          on: { click: () => view.set({ kind: kind === "bar" ? "line" : "bar" }) },
        },
        kind === "bar" ? t("Linee") : t("Barre"),
      ),
    ),
    draw(data, kind),
  );
}

/**
 * Grafico della tabella che lo precede nella nota, sempre aggiornato. In Markdown è la riga
 * `[[chart:bar]]` o `[[chart:line]]`: i dati restano nella tabella.
 */
const ChartBlock = dataBlock<Chart>({
  name: "chart",
  tag: "chart",
  empty: { kind: "bar" },
  format: {
    kind: "line",
    match: /^\[\[chart:(bar|line)\]\]$/i,
    parse: (m) => ({ kind: m[1].toLowerCase() === "line" ? "line" : "bar" }),
    write: (data) => `[[chart:${data.kind}]]`,
  },
  render,
});

export const chart: EditorPlugin = {
  name: "chart",
  extensions: () => [ChartBlock],
  commands: [
    {
      id: "chart",
      get title() {
        return t("Grafico");
      },
      get hint() {
        return t("Disegna la tabella qui sopra");
      },
      icon: "▟",
      get group() {
        return t("Strumenti");
      },
      keywords: ["grafico", "chart", "barre", "linee", "istogramma", "andamento", "tabella"],
      run: (e) => e.chain().focus().insertContent({ type: "chart" }).run(),
    },
  ],
};
