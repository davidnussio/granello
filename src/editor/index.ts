import type { EditorPlugin, PluginContext, ResolvedPlugins } from "./types";
import { base } from "./plugins/base";
import { formatting } from "./plugins/formatting";
import { headings } from "./plugins/headings";
import { lists } from "./plugins/lists";
import { tasks } from "./plugins/tasks";
import { blocks } from "./plugins/blocks";
import { links } from "./plugins/links";
import { snippets } from "./plugins/snippets";
import { highlight } from "./plugins/highlight";
import { mention } from "./plugins/mention";
import { date } from "./plugins/date";
import { math } from "./plugins/math";
import { callout } from "./plugins/callout";
import { toggle } from "./plugins/toggle";
import { columns } from "./plugins/columns";
import { table } from "./plugins/table";
import { media } from "./plugins/media";
import { linkCard } from "./plugins/linkCard";
import { toc } from "./plugins/toc";
import { poll } from "./plugins/poll";
import { kanban } from "./plugins/kanban";
import { timeline } from "./plugins/timeline";
import { prosCons } from "./plugins/prosCons";
import { matrix } from "./plugins/matrix";
import { rating } from "./plugins/rating";
import { timer } from "./plugins/timer";
import { progress } from "./plugins/progress";
import { chart } from "./plugins/chart";
import { diagram } from "./plugins/diagram";
import { sketch } from "./plugins/sketch";
import { embed } from "./plugins/embed";
import { moment } from "./plugins/moment";
import { transcriptQuote } from "./plugins/transcriptQuote";
import { ai } from "./plugins/ai";
import { find } from "./plugins/find";

export type { CommandItem, EditorPlugin, PluginContext, SuggestMenu, ToolbarItem } from "./types";
export { base, formatting, headings, lists, tasks, blocks, links, snippets };
export {
  highlight,
  mention,
  date,
  math,
  callout,
  toggle,
  columns,
  table,
  media,
  linkCard,
  toc,
  poll,
  kanban,
  timeline,
  prosCons,
  matrix,
  rating,
  timer,
  progress,
  chart,
  diagram,
  sketch,
  embed,
  moment,
  transcriptQuote,
  ai,
  find,
};

/** Plugin attivi di default. L'ordine determina l'ordine di comandi e pulsanti. */
export const defaultPlugins: EditorPlugin[] = [
  base,
  formatting,
  highlight,
  headings,
  toc,
  lists,
  tasks,
  blocks,
  table,
  toggle,
  columns,
  math,
  callout,
  links,
  media,
  linkCard,
  snippets,
  poll,
  kanban,
  timeline,
  prosCons,
  matrix,
  rating,
  timer,
  progress,
  chart,
  diagram,
  sketch,
  embed,
  moment,
  transcriptQuote,
  ai,
  mention,
  date,
  find,
];

/** Unisce i contributi dei plugin. Un plugin successivo con lo stesso `name` sostituisce il precedente. */
export function resolvePlugins(plugins: EditorPlugin[], ctx: PluginContext): ResolvedPlugins {
  const byName = new Map<string, EditorPlugin>();
  for (const p of plugins) byName.set(p.name, p);
  const out: ResolvedPlugins = { extensions: [], commands: [], toolbar: [] };
  for (const p of byName.values()) {
    out.extensions.push(...(p.extensions?.(ctx) ?? []));
    out.commands.push(...(p.commands ?? []));
    out.toolbar.push(...(p.toolbar ?? []));
  }
  return out;
}

/**
 * Riunisce i comandi dello stesso gruppo, così il menu mostra ogni intestazione una volta sola
 * anche quando plugin lontani nell'elenco usano lo stesso gruppo (es. "Allegati", "Meeting").
 * I gruppi restano nell'ordine in cui compaiono la prima volta, e dentro un gruppo l'ordine non
 * cambia: con una ricerca, il gruppo della voce migliore resta in cima.
 */
export function groupCommands<T extends { group: string }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.group);
    if (list) list.push(item);
    else groups.set(item.group, [item]);
  }
  return [...groups.values()].flat();
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Ricerca per il menu "/": senza distinzione di maiuscole e accenti, su titolo e parole chiave.
 * Anche il nome del gruppo è una chiave: "/note" mostra tutti i blocchi del gruppo Note,
 * "/strum" tutti gli strumenti. Un gruppo scritto per intero viene prima di tutto il resto.
 */
export function filterCommands<T extends { title: string; keywords?: string[]; group?: string }>(
  items: T[],
  query: string,
): T[] {
  const q = norm(query.trim());
  if (!q) return items;
  const group = (i: T) => norm(i.group ?? "");
  // con una o due lettere il gruppo porterebbe dentro mezzo menu: conta da tre in su
  const whole = items.filter((i) => group(i) === q);
  const inGroup = q.length >= 3 ? items.filter((i) => !whole.includes(i) && group(i).startsWith(q)) : [];
  const starts = items.filter((i) => !whole.includes(i) && norm(i.title).startsWith(q));
  const rest = items.filter(
    (i) =>
      !whole.includes(i) &&
      !starts.includes(i) &&
      (norm(i.title).includes(q) || (i.keywords ?? []).some((k) => norm(k).startsWith(q))),
  );
  return [...new Set([...whole, ...starts, ...inGroup, ...rest])];
}
