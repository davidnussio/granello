import type { EditorPlugin, PluginContext, ResolvedPlugins } from "./types";
import { base } from "./plugins/base";
import { formatting } from "./plugins/formatting";
import { headings } from "./plugins/headings";
import { lists } from "./plugins/lists";
import { tasks } from "./plugins/tasks";
import { blocks } from "./plugins/blocks";
import { links } from "./plugins/links";
import { snippets } from "./plugins/snippets";

export type { CommandItem, EditorPlugin, PluginContext, ToolbarItem } from "./types";
export { base, formatting, headings, lists, tasks, blocks, links, snippets };

/** Plugin attivi di default. L'ordine determina l'ordine di comandi e pulsanti. */
export const defaultPlugins: EditorPlugin[] = [base, formatting, headings, lists, tasks, blocks, links, snippets];

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
