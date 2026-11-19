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

export type { CommandItem, EditorPlugin, PluginContext, SuggestMenu, ToolbarItem } from "./types";
export { base, formatting, headings, lists, tasks, blocks, links, snippets };
export { highlight, mention, date, math, callout, toggle, columns, table, media, linkCard, toc, poll, kanban, timeline, prosCons };

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
  mention,
  date,
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

/** Ricerca per il menu "/": senza distinzione di maiuscole e accenti, su titolo e parole chiave. */
export function filterCommands<T extends { title: string; keywords?: string[] }>(items: T[], query: string): T[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  const q = norm(query.trim());
  if (!q) return items;
  const starts = items.filter((i) => norm(i.title).startsWith(q));
  const rest = items.filter(
    (i) => !starts.includes(i) && (norm(i.title).includes(q) || (i.keywords ?? []).some((k) => norm(k).startsWith(q))),
  );
  return [...starts, ...rest];
}
