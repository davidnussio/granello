import type { Project } from "./types";
import { locale } from "./i18n";

/** Come si scrive un progetto dentro un altro: `dambox › bizcard`. */
export const PATH_SEPARATOR = " › ";

const byName = (a: string, b: string) => a.localeCompare(b, locale(), { sensitivity: "base" });

/** Il progetto con quelli sopra, dal primo livello. Un genitore che non c'è chiude il percorso. */
export function projectPath(id: string | null | undefined, projects: Project[]): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out: Project[] = [];
  const seen = new Set<string>();
  let p = id ? byId.get(id) : undefined;
  while (p && !seen.has(p.id)) {
    seen.add(p.id);
    out.unshift(p);
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return out;
}

/** Il nome completo di un progetto: `dambox › bizcard`. */
export const projectTitle = (id: string | null | undefined, projects: Project[]) =>
  projectPath(id, projects)
    .map((p) => p.name)
    .join(PATH_SEPARATOR);

/** Un progetto è archiviato se lo è lui o uno di quelli che lo contengono. */
export const archivedIn = (id: string, projects: Project[]) =>
  projectPath(id, projects).some((p) => p.archived);

/** I progetti nell'ordine dell'albero (ognuno seguito dai suoi), con la loro profondità. */
export function projectTree(projects: Project[]): { project: Project; depth: number }[] {
  const ids = new Set(projects.map((p) => p.id));
  const kids = new Map<string | null, Project[]>();
  for (const p of projects) {
    // un genitore che non c'è (cancellato, o non ancora arrivato dal sync) vale come nessuno
    const parent = p.parentId && ids.has(p.parentId) && p.parentId !== p.id ? p.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), p]);
  }
  const out: { project: Project; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    const list = (kids.get(parent) ?? []).toSorted(
      (a, b) => Number(a.archived) - Number(b.archived) || byName(a.name, b.name),
    );
    for (const p of list) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  // un giro (che solo un sync andato storto lascerebbe) non sparisce: in fondo, al primo livello
  for (const p of projects) if (!seen.has(p.id)) out.push({ project: p, depth: 0 });
  return out;
}

/** Il progetto e tutti quelli che contiene, a ogni livello. */
export function projectBranch(id: string, projects: Project[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) {
      if (p.parentId && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * I progetti da offrire in un menu: nell'ordine dell'albero e con il nome completo, senza gli
 * archiviati (salvo `keep`, quello già scelto).
 */
export const projectOptions = (projects: Project[], keep?: string | null) =>
  projectTree(projects)
    .filter(({ project }) => project.id === keep || !archivedIn(project.id, projects))
    .map(({ project }) => ({ id: project.id, label: projectTitle(project.id, projects) }));

/** I livelli di un tag scritto con `/`: `progetto/bizcard` → `progetto`, `progetto/bizcard`. */
export function tagLevels(tag: string): string[] {
  const parts = tag.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}
