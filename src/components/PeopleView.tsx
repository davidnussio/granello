import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText } from "../api";
import type { Group, ImportedPerson, Person } from "../types";
import { dayLabel, sameDay, shortWhen } from "../format";
import { t } from "../i18n";
import { groupOptions, projectBranch, projectPath, projectTitle, projectTree } from "../tree";
import GroupDialog, { kindHint } from "./GroupDialog";
import { MergeRow, VcardImport } from "./PeopleParts";
import { ProjectDot } from "./ProjectDialog";

interface Props {
  groups: Group[];
  onGroupsChanged: (groups: Group[]) => void;
  /** Il gruppo da mostrare all'apertura (dal chip di una nota). */
  initialGroup?: string;
  toast: (text: string) => void;
  /** Apre la Libreria sulle note di una persona. */
  onOpenPerson: (name: string) => void;
  /** Apre la Libreria sulle note di un gruppo. */
  onOpenGroup: (id: string) => void;
  /** Apre Impostazioni → Persone (la rubrica del Mac). */
  onOpenSettings: () => void;
}

/** La colonna per cui si ordina, e in che verso. */
type SortKey = "name" | "email" | "meetings" | "recent";
/** Cosa mostra l'elenco: tutti, chi non è in nessun gruppo, o i membri di un gruppo (id). */
type Scope = "all" | "none" | string;
/** La riga in modifica: i valori dei campi e quello che ha il cursore. */
interface Editing {
  id: number;
  name: string;
  email: string;
  field: "name" | "email";
}

/** Voci del menu delle persone scelte che non sono un gruppo. */
const NEW_GROUP = "+new";
const REMOVE_FROM = "-out";
/** I chip dei gruppi in una riga, prima di «+N»: la riga resta alta uguale alle altre. */
const CHIPS = 2;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const peopleCount = (n: number) => (n === 1 ? t("1 persona") : t("{n} persone", { n }));
/** «Oggi», «Ieri», «Lun», «11 nov»: una riga sola anche nella colonna stretta. */
const lastLabel = (ts: number) => {
  if (sameDay(ts, Date.now())) return dayLabel(ts);
  const s = shortWhen(ts);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Il messaggio dopo aver aggiunto `n` persone al gruppo `name`. */
const added = (n: number, name: string) =>
  n === 0
    ? t("Sono già tutte in «{name}»", { name })
    : n === 1
      ? t("1 persona aggiunta a «{name}»", { name })
      : t("{n} persone aggiunte a «{name}»", { n, name });

/**
 * Un elenco incollato (una persona per riga, da un foglio di calcolo o da un'email): nome ed
 * email, separati da tabulazione, punto e virgola o virgola, oppure `Nome <email>`.
 */
function parseList(text: string): ImportedPerson[] {
  const out: ImportedPerson[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const angle = line.match(/^(.*?)\s*<([^>]+@[^>]+)>$/);
    let name = "";
    let email: string | null = null;
    if (angle) {
      name = angle[1].replace(/^["']|["']$/g, "").trim();
      email = angle[2].trim();
    } else {
      for (const part of line.split(/\t|;|,/).map((p) => p.trim())) {
        if (!part) continue;
        if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) email = part;
        else if (!name) name = part;
      }
    }
    // solo l'email: il nome si ricava da quello che c'è prima della @ («marco.bianchi» → «Marco Bianchi»)
    if (!name && email)
      name = email
        .split("@")[0]
        .split(/[._-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    name = name.replace(/\s+/g, " ").slice(0, 80);
    if (name && !out.some((p) => same(p.name, name))) out.push({ name, email, known: false });
  }
  return out;
}

/**
 * La pagina Persone: a sinistra i gruppi (team, reparti, clienti, tutta l'azienda) in albero, a
 * destra le persone del gruppo scelto. Pensata per rubriche grandi: righe tutte alte uguali,
 * nome ed email si correggono in riga (Invio salva e passa alla riga sotto), più persone si
 * scelgono con clic, Maiusc + clic, ⌘A o la tastiera e si mettono in un gruppo, si spostano,
 * si uniscono o si tolgono insieme; un elenco incollato nel campo di ricerca entra tutto.
 */
export default function PeopleView({
  groups,
  onGroupsChanged,
  initialGroup,
  toast,
  onOpenPerson,
  onOpenGroup,
  onOpenSettings,
}: Props) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [scope, setScope] = useState<Scope>(initialGroup ?? "all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  /** Le persone scelte, per metterle in un gruppo, spostarle, unirle o toglierle. */
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  /** L'ultima riga scelta: da lì Maiusc + clic sceglie fino alla nuova. */
  const [anchor, setAnchor] = useState<number | null>(null);
  /** La riga dove sono le frecce. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** La riga che sta scegliendo con chi unirsi, e la scelta. */
  const [merging, setMerging] = useState<{ id: number; into: number | null } | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  /** Cosa aspetta il secondo clic di conferma: una riga, le persone scelte o il gruppo. */
  const [confirming, setConfirming] = useState<number | "picked" | "group" | null>(null);
  const [importing, setImporting] = useState<ImportedPerson[] | null>(null);
  /** Un elenco incollato, in attesa di conferma. */
  const [pasted, setPasted] = useState<ImportedPerson[] | null>(null);
  const [dialog, setDialog] = useState<
    { mode: "new"; parentId?: string; members?: string[] } | { mode: "edit"; group: Group } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const table = useRef<HTMLDivElement>(null);
  /** La riga in modifica com'è adesso: chi salva uscendo dalla riga non deve leggerne una vecchia. */
  const editRef = useRef(editing);
  editRef.current = editing;

  const load = () =>
    api
      .listPeople()
      .then(setPeople)
      .catch((e) => toast(errorText(e)));

  useEffect(() => {
    void load();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- si carica una volta, all'apertura
  }, []);

  const group = groups.find((g) => g.id === scope) ?? null;
  // un gruppo tolto (da qui o dal sync) non resta scelto
  useEffect(() => {
    if (scope !== "all" && scope !== "none" && !group) setScope("all");
  }, [scope, group]);
  useEffect(() => {
    setPicked(new Set());
    setConfirming(null);
    setQuery("");
    setPasted(null);
    setEditing(null);
  }, [scope]);

  /** I gruppi di ogni persona, per nome. */
  const groupsOf = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of groups) {
      for (const m of g.members) {
        const key = m.toLowerCase();
        map.set(key, [...(map.get(key) ?? []), g]);
      }
    }
    return map;
  }, [groups]);

  /** Quante persone ha un gruppo contando anche quelli che contiene: «Clienti» non è vuoto. */
  const branchSize = useMemo(() => {
    const out = new Map<string, number>();
    for (const g of groups) {
      const branch = projectBranch(g.id, groups);
      const names = new Set(
        groups.filter((x) => branch.has(x.id)).flatMap((x) => x.members.map((m) => m.toLowerCase())),
      );
      out.set(g.id, names.size);
    }
    return out;
  }, [groups]);

  const all = useMemo(() => people ?? [], [people]);
  const inScope = useMemo(() => {
    if (scope === "all") return all;
    if (scope === "none") return all.filter((p) => !groupsOf.has(p.name.toLowerCase()));
    const members = new Set((group?.members ?? []).map((m) => m.toLowerCase()));
    return all.filter((p) => members.has(p.name.toLowerCase()));
  }, [all, scope, group, groupsOf]);

  const q = query.trim().toLowerCase();
  const matches = (p: Person) =>
    !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q);

  const shown = useMemo(() => {
    const dir = sort.desc ? -1 : 1;
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    return inScope.filter(matches).toSorted((a, b) => {
      const d =
        sort.key === "meetings"
          ? a.meetings - b.meetings
          : sort.key === "recent"
            ? (a.lastMeetingAt ?? 0) - (b.lastMeetingAt ?? 0)
            : sort.key === "email"
              ? (a.email ?? "￿").localeCompare(b.email ?? "￿")
              : byName(a, b);
      return d * dir || byName(a, b);
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `matches` dipende solo da `q`
  }, [inScope, q, sort]);

  /** Chi si può aggiungere scrivendo nel campo: persone della rubrica fuori dal gruppo, o un nome nuovo. */
  const addable = useMemo(() => {
    if (!q || scope === "none") return { known: [] as Person[], fresh: "" };
    const outside = group ? all.filter((p) => !group.members.some((m) => same(m, p.name))) : [];
    const known = outside.filter(matches).slice(0, 5);
    const typed = query.trim().replace(/\s+/g, " ");
    const exists = all.some((p) => same(p.name, typed));
    return { known, fresh: exists || typed.length > 80 ? "" : typed };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `matches` dipende solo da `q`
  }, [q, query, scope, group, all]);

  const chosen = all.filter((p) => picked.has(p.id));
  const noGroup = all.filter((p) => !groupsOf.has(p.name.toLowerCase())).length;

  /** Un gruppo cambiato: si aggiorna nell'elenco di tutti. */
  const replaceGroup = (saved: Group) => onGroupsChanged(groups.map((g) => (g.id === saved.id ? saved : g)));

  const changeSort = (key: SortKey) =>
    setSort((now) =>
      now.key === key ? { key, desc: !now.desc } : { key, desc: key === "meetings" || key === "recent" },
    );

  const pick = (id: number, shift: boolean) => {
    const index = shown.findIndex((x) => x.id === id);
    const next = new Set(picked);
    const on = !next.has(id);
    const from = shift && anchor !== null ? shown.findIndex((x) => x.id === anchor) : -1;
    if (from >= 0 && index >= 0) {
      const [a, b] = from < index ? [from, index] : [index, from];
      for (const x of shown.slice(a, b + 1)) {
        if (on) next.add(x.id);
        else next.delete(x.id);
      }
    } else if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
    setAnchor(id);
    setCursor(id);
    setConfirming(null);
  };

  const allPicked = shown.length > 0 && shown.every((p) => picked.has(p.id));
  const pickAll = (on: boolean) => {
    const next = new Set(picked);
    for (const p of shown) {
      if (on) next.add(p.id);
      else next.delete(p.id);
    }
    setPicked(next);
  };

  const changeMembers = async (g: Group, add: string[], remove: string[]) => {
    setBusy(true);
    try {
      const saved = await api.changeGroupMembers(g.id, add, remove);
      replaceGroup(saved);
      return saved;
    } catch (e) {
      toast(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Il menu delle persone scelte: aggiungere, spostare o togliere da un gruppo. */
  const groupAction = async (value: string) => {
    if (value === NEW_GROUP) {
      setDialog({ mode: "new", members: chosen.map((p) => p.name) });
      return;
    }
    const names = chosen.map((p) => p.name);
    if (value === REMOVE_FROM) {
      if (!group || (await changeMembers(group, [], names)) === null) return;
      setPicked(new Set());
      toast(
        names.length === 1
          ? t("1 persona tolta da «{name}»", { name: group.name })
          : t("{n} persone tolte da «{name}»", { n: names.length, name: group.name }),
      );
      return;
    }
    const [mode, id] = value.split(":");
    const target = groups.find((x) => x.id === id);
    if (!target) return;
    const fresh = names.filter((n) => !target.members.some((m) => same(m, n)));
    if ((await changeMembers(target, fresh, [])) === null) return;
    if (mode === "move" && group) {
      if ((await changeMembers(group, [], names)) === null) return;
      toast(
        names.length === 1
          ? t("1 persona spostata in «{name}»", { name: target.name })
          : t("{n} persone spostate in «{name}»", { n: names.length, name: target.name }),
      );
    } else toast(added(fresh.length, target.name));
    setPicked(new Set());
  };

  /** Aggiunge al gruppo aperto (o alla rubrica) chi è già in rubrica o un nome nuovo. */
  const addPeople = async (list: ImportedPerson[]) => {
    if (list.length === 0) return;
    setBusy(true);
    try {
      // chi è già in rubrica si riconosce dall'email, poi dal nome
      list = list.map((p) => {
        const byEmail = p.email ? all.find((x) => x.email && same(x.email, p.email!)) : undefined;
        return byEmail ? { ...p, name: byEmail.name } : p;
      });
      const fresh = list.filter((p) => !all.some((x) => same(x.name, p.name)));
      // chi è nuovo entra in rubrica (con l'email, se c'è); chi c'è riceve l'email se non l'aveva
      setPeople(await api.addPeople(list.map((p) => ({ ...p, known: !fresh.includes(p) }))));
      if (group) {
        const names = list.map((p) => all.find((x) => same(x.name, p.name))?.name ?? p.name);
        const before = group.members.length;
        const saved = await api.changeGroupMembers(group.id, names, []);
        replaceGroup(saved);
        toast(added(saved.members.length - before, group.name));
      } else
        toast(fresh.length === 1 ? t("1 persona aggiunta") : t("{n} persone aggiunte", { n: fresh.length }));
      setQuery("");
      setPasted(null);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteGroup = async (g: Group) => {
    if (confirming !== "group") {
      setConfirming("group");
      return;
    }
    try {
      onGroupsChanged(await api.deleteGroup(g.id));
      setScope(g.parentId ?? "all");
      toast(t("Gruppo «{name}» eliminato: le note e le persone restano.", { name: g.name }));
    } catch (e) {
      toast(errorText(e));
    }
  };

  /** Salva la riga in modifica se è cambiata; poi apre `next` (un'altra riga) o chiude. */
  const saveEdit = async (next?: Editing | null) => {
    const row = editRef.current;
    if (!row || busy) return;
    const before = all.find((p) => p.id === row.id);
    const name = row.name.trim();
    const email = row.email.trim();
    const changed = !!before && (name !== before.name || email !== (before.email ?? ""));
    if (changed) {
      setBusy(true);
      try {
        setPeople(await api.updatePerson(row.id, name, email || null));
        // il nome nuovo arriva anche nei gruppi
        if (name !== before.name) onGroupsChanged(await api.listGroups());
      } catch (e) {
        setError({ id: row.id, text: errorText(e) });
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setError(null);
    setEditing(next ?? null);
    if (next) setCursor(next.id);
    else table.current?.focus();
  };

  const startEdit = (p: Person, field: Editing["field"] = "name") => {
    setMerging(null);
    setError(null);
    setConfirming(null);
    setCursor(p.id);
    setEditing({ id: p.id, name: p.name, email: p.email ?? "", field });
  };

  /** La riga sopra o sotto quella in modifica, pronta da modificare nello stesso campo. */
  const neighbour = (step: 1 | -1, field: Editing["field"]): Editing | null => {
    if (!editing) return null;
    const p = shown[shown.findIndex((x) => x.id === editing.id) + step];
    return p ? { id: p.id, name: p.name, email: p.email ?? "", field } : null;
  };

  const merge = async (from: Person, into: Person) => {
    setBusy(true);
    try {
      setPeople(await api.mergePeople(from.id, into.id));
      onGroupsChanged(await api.listGroups());
      setMerging(null);
      setPicked(new Set());
      toast(t("{from} unito a {into}", { from: from.name, into: into.name }));
    } catch (e) {
      setError({ id: from.id, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  /** Due persone scelte: si unisce quella con meno note a quella con più note (si può cambiare). */
  const mergePicked = () => {
    const [a, b] = chosen.toSorted((x, y) => x.meetings - y.meetings);
    setEditing(null);
    setMerging({ id: a.id, into: b.id });
  };

  /** Toglie dalla rubrica (e dai gruppi): al primo clic chiede conferma. */
  const remove = async (list: Person[], key: number | "picked") => {
    if (confirming !== key) {
      setConfirming(key);
      return;
    }
    setConfirming(null);
    setBusy(true);
    try {
      for (const p of list) await api.deletePerson(p.id);
      await load();
      onGroupsChanged(await api.listGroups());
      setPicked(new Set());
      toast(
        list.length === 1
          ? t("«{name}» non è più in rubrica: le note non cambiano.", { name: list[0].name })
          : t("{n} persone tolte dalla rubrica: le note non cambiano.", { n: list.length }),
      );
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const pickVcard = async () => {
    try {
      const found = await api.pickVcard();
      if (found) setImporting(found);
    } catch (e) {
      toast(errorText(e));
    }
  };

  /** Le frecce nell'elenco: ↑↓ si muovono (con Maiusc scelgono), Spazio sceglie, Invio modifica. */
  const onTableKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, select, button, textarea")) return;
    const at = shown.findIndex((p) => p.id === cursor);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (!next) return;
      if (e.shiftKey && !picked.has(next.id)) pick(next.id, false);
      setCursor(next.id);
    } else if (e.key === " " && at >= 0) {
      e.preventDefault();
      pick(shown[at].id, e.shiftKey);
    } else if (e.key === "Enter" && at >= 0) {
      e.preventDefault();
      startEdit(shown[at]);
    }
  };

  // la riga delle frecce resta visibile
  useEffect(() => {
    if (cursor === null) return;
    table.current?.querySelector(`[data-person="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const tree = projectTree(groups);
  const sortHead = (key: SortKey, label: string, className = "") => (
    <span
      role="columnheader"
      className={className}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      <button className="roster-sort" onClick={() => changeSort(key)}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.desc ? " ↓" : " ↑"}</span>}
      </button>
    </span>
  );
  const placeholder = group
    ? t("Cerca o aggiungi a «{name}»", { name: group.name })
    : scope === "all"
      ? t("Cerca o aggiungi una persona")
      : t("Cerca per nome o email");

  return (
    <div
      className="people-page"
      onKeyDown={(e) => {
        // ⌘A fuori dai campi: sceglie tutte le persone in elenco
        const field = (e.target as HTMLElement).closest("input, textarea, select");
        if ((e.metaKey || e.ctrlKey) && e.key === "a" && !field) {
          e.preventDefault();
          pickAll(true);
        } else if (e.key === "Escape" && !field && (picked.size || confirming !== null)) {
          setPicked(new Set());
          setConfirming(null);
        }
      }}
    >
      <div className="lib-top">
        <h1 className="lib-title">{t("Persone")}</h1>
        <span className="muted small people-total">{peopleCount(all.length)}</span>
        <div className="spacer" />
        <button className="btn small ghost" onClick={pickVcard} title={t("Aggiungi persone da un file .vcf")}>
          {t("Importa vCard…")}
        </button>
        <button
          className="btn small ghost"
          onClick={onOpenSettings}
          title={t("Rubrica del Mac e altre impostazioni")}
        >
          {t("Impostazioni")}
        </button>
      </div>

      <div className="people-cols">
        <nav className="lib-col people-groups" aria-label={t("Gruppi")}>
          <button className={"lib-row" + (scope === "all" ? " on" : "")} onClick={() => setScope("all")}>
            <span className="lib-icon">☺</span>
            <span className="lib-label">{t("Tutte le persone")}</span>
            <span className="lib-count">{all.length}</span>
          </button>
          <button className={"lib-row" + (scope === "none" ? " on" : "")} onClick={() => setScope("none")}>
            <span className="lib-icon">○</span>
            <span className="lib-label">{t("Senza gruppo")}</span>
            <span className="lib-count">{noGroup}</span>
          </button>
          <div className="lib-facet-head people-groups-head">{t("Gruppi")}</div>
          {tree.map(({ project: g, depth }) => {
            const size = branchSize.get(g.id) ?? 0;
            return (
              <button
                key={g.id}
                className={"lib-row people-group-row" + (scope === g.id ? " on" : "")}
                style={{ "--depth": depth } as React.CSSProperties}
                title={`${projectTitle(g.id, groups)} · ${peopleCount(size)}${g.description ? `\n${g.description}` : ""}`}
                onClick={() => setScope(g.id)}
              >
                <ProjectDot project={g} />
                <span className="lib-label">{g.name}</span>
                <span className="lib-count">{size}</span>
              </button>
            );
          })}
          {groups.length === 0 && (
            <p className="muted small lib-empty">
              {t(
                "Ancora nessun gruppo. Un gruppo riunisce un team, un reparto, un cliente o tutta l'azienda.",
              )}
            </p>
          )}
          <button className="lib-new" onClick={() => setDialog({ mode: "new" })}>
            {t("+ Nuovo gruppo")}
          </button>
        </nav>

        <section className="people-main">
          {group && (
            <header className="people-group-head">
              <div className="people-group-title">
                <ProjectDot project={group} />
                <h2>
                  {projectPath(group.id, groups)
                    .slice(0, -1)
                    .map((up) => (
                      <span key={up.id} className="muted">
                        <button className="link-button" onClick={() => setScope(up.id)}>
                          {up.name}
                        </button>
                        {" › "}
                      </span>
                    ))}
                  {group.name}
                </h2>
                <span className="people-kind" title={kindHint(group.kind)}>
                  {group.kind === "team" ? t("Team") : t("Pubblico")}
                </span>
              </div>
              {group.description && <p className="people-group-desc muted small">{group.description}</p>}
              <div className="people-group-acts">
                {group.meetings > 0 ? (
                  <button
                    className="people-link"
                    onClick={() => onOpenGroup(group.id)}
                    title={t("Apri le note del gruppo nella Libreria")}
                  >
                    {group.meetings === 1 ? t("1 nota →") : t("{n} note →", { n: group.meetings })}
                  </button>
                ) : (
                  <span
                    className="muted"
                    title={t("Nessuna nota con questo gruppo: aggiungilo a una nota, sotto il titolo.")}
                  >
                    {t("Nessuna nota")}
                  </span>
                )}
                <span className="people-sep" aria-hidden="true" />
                <button className="people-link" onClick={() => setDialog({ mode: "edit", group })}>
                  {t("Modifica…")}
                </button>
                <button
                  className="people-link"
                  onClick={() => setDialog({ mode: "new", parentId: group.id })}
                >
                  {t("+ Gruppo dentro")}
                </button>
                <button
                  className={"people-link" + (confirming === "group" ? " danger" : "")}
                  onClick={() => void deleteGroup(group)}
                  onBlur={() => setConfirming((c) => (c === "group" ? null : c))}
                  title={t("Le note e le persone restano: sparisce solo il gruppo")}
                >
                  {confirming === "group" ? t("Eliminare il gruppo?") : t("Elimina")}
                </button>
              </div>
            </header>
          )}

          {/* con delle persone scelte, al posto della ricerca: l'elenco sotto non si sposta */}
          {picked.size > 0 ? (
            <div className="roster-tools people-bulk" role="toolbar" aria-label={t("Persone scelte")}>
              <strong>{peopleCount(picked.size)}</strong>
              <select
                className="chip select"
                value=""
                disabled={busy}
                aria-label={t("Gruppi delle persone scelte")}
                onChange={(e) => void groupAction(e.target.value)}
              >
                <option value="">{t("Gruppo…")}</option>
                <optgroup label={t("Aggiungi a")}>
                  {groupOptions(groups).map((g) => (
                    <option key={g.id} value={`add:${g.id}`}>
                      {g.label}
                    </option>
                  ))}
                  <option value={NEW_GROUP}>{t("Un gruppo nuovo…")}</option>
                </optgroup>
                {group && (
                  <optgroup label={t("Sposta da «{name}» a", { name: group.name })}>
                    {groupOptions(groups)
                      .filter((g) => g.id !== group.id)
                      .map((g) => (
                        <option key={g.id} value={`move:${g.id}`}>
                          {g.label}
                        </option>
                      ))}
                  </optgroup>
                )}
                {group && <option value={REMOVE_FROM}>{t("Togli da «{name}»", { name: group.name })}</option>}
              </select>
              {picked.size === 2 && (
                <button
                  className="btn small ghost"
                  disabled={busy}
                  onClick={mergePicked}
                  title={t("Sono la stessa persona, scritta in due modi")}
                >
                  {t("Unisci")}
                </button>
              )}
              <button
                className={"btn small ghost" + (confirming === "picked" ? " danger" : "")}
                disabled={busy}
                onClick={() => void remove(chosen, "picked")}
                onBlur={() => setConfirming((c) => (c === "picked" ? null : c))}
                title={t("Toglie le persone scelte dalla rubrica e dai gruppi: le note non cambiano")}
              >
                {confirming === "picked" ? t("Rimuovere {n}?", { n: picked.size }) : t("Rimuovi")}
              </button>
              <div className="spacer" />
              <button
                className="btn small ghost people-bulk-x"
                aria-label={t("Annulla la scelta")}
                title={t("Annulla la scelta (Esc)")}
                onClick={() => setPicked(new Set())}
              >
                ×
              </button>
            </div>
          ) : (
            <form
              className="roster-tools"
              onSubmit={(e) => {
                e.preventDefault();
                // Invio: aggiunge l'unica proposta, o il nome nuovo scritto
                if (addable.known.length === 1 && !addable.fresh)
                  void addPeople([{ ...addable.known[0], known: true }]);
                else if (addable.fresh && addable.known.length === 0)
                  void addPeople([{ name: addable.fresh, email: null, known: false }]);
              }}
            >
              <input
                className="search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onPaste={(e) => {
                  // un elenco di nomi (da un foglio di calcolo o un'email) non si cerca: si aggiunge
                  const list = parseList(e.clipboardData.getData("text"));
                  if (list.length < 2 || scope === "none") return;
                  e.preventDefault();
                  setPasted(list);
                }}
                placeholder={placeholder}
                aria-label={placeholder}
                title={
                  scope === "none"
                    ? undefined
                    : t(
                        "Incolla un elenco (una persona per riga, anche da un foglio di calcolo) per aggiungerle tutte",
                      )
                }
              />
            </form>
          )}

          {pasted && (
            <div className="people-add-strip">
              <span>
                {group
                  ? t("Aggiungere {n} persone a «{name}»?", { n: pasted.length, name: group.name })
                  : t("Aggiungere {n} persone alla rubrica?", { n: pasted.length })}
                <span className="muted small">
                  {" "}
                  {pasted
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join(", ")}
                  {pasted.length > 3 ? "…" : ""}
                </span>
              </span>
              <div className="spacer" />
              <button className="btn small ghost" onClick={() => setPasted(null)}>
                {t("Annulla")}
              </button>
              <button className="btn small" disabled={busy} onClick={() => void addPeople(pasted)}>
                {t("Aggiungi {n}", { n: pasted.length })}
              </button>
            </div>
          )}
          {!pasted && (addable.known.length > 0 || addable.fresh) && (
            <div className="people-add-strip">
              <span className="muted small">
                {group ? t("Aggiungi a «{name}»:", { name: group.name }) : t("Aggiungi:")}
              </span>
              {addable.known.map((p) => (
                <button
                  key={p.id}
                  className="people-chip add"
                  disabled={busy}
                  onClick={() => void addPeople([{ name: p.name, email: p.email, known: true }])}
                >
                  + {p.name}
                </button>
              ))}
              {addable.fresh && (
                <button
                  className="people-chip add fresh"
                  disabled={busy}
                  onClick={() => void addPeople([{ name: addable.fresh, email: null, known: false }])}
                  title={t("Una persona nuova, che entra anche in rubrica")}
                >
                  {t("+ «{name}» (nuova)", { name: addable.fresh })}
                </button>
              )}
            </div>
          )}

          {people === null ? null : all.length === 0 && !q ? (
            <p className="muted small">
              {t(
                "Ancora nessuna persona: si aggiungono da sole con i partecipanti delle note, scrivendo un nome qui sopra o importandole da un file vCard.",
              )}
            </p>
          ) : (
            <div
              ref={table}
              className="roster-table people-roster"
              role="grid"
              aria-multiselectable="true"
              aria-label={t("Persone")}
              tabIndex={0}
              onKeyDown={onTableKey}
              onFocus={() => {
                if (cursor === null && shown[0]) setCursor(shown[0].id);
              }}
            >
              <div className="roster-row head" role="row">
                <span role="columnheader" className="roster-check">
                  <input
                    type="checkbox"
                    checked={allPicked}
                    disabled={shown.length === 0}
                    aria-label={t("Scegli tutte le persone in elenco")}
                    onChange={(e) => pickAll(e.target.checked)}
                  />
                </span>
                {sortHead("name", t("Nome"))}
                {sortHead("email", t("Email"), "col-email")}
                <span role="columnheader" className="col-groups">
                  {group ? t("Altri gruppi") : t("Gruppi")}
                </span>
                {sortHead("meetings", t("Note"), "num")}
                {sortHead("recent", t("Ultima"), "col-last")}
                <span role="columnheader" aria-label={t("Azioni")} />
              </div>
              {shown.map((p) => {
                const own = (groupsOf.get(p.name.toLowerCase()) ?? []).filter((g) => g.id !== group?.id);
                const edit = editing?.id === p.id ? editing : null;
                return (
                  <div
                    key={p.id}
                    data-person={p.id}
                    className={
                      "roster-group" +
                      (picked.has(p.id) ? " picked" : "") +
                      (cursor === p.id ? " cur" : "") +
                      (edit ? " inline-edit" : "")
                    }
                  >
                    <div
                      className="roster-row"
                      role="row"
                      // un clic sulla riga la sceglie, come la casella; nome e chip hanno il loro clic
                      onClick={(e) => {
                        if (edit || (e.target as HTMLElement).closest("button, input, a")) return;
                        pick(p.id, e.shiftKey);
                      }}
                      onBlur={(e) => {
                        // si esce dalla riga in modifica (non verso la riga dopo): si salva quello che è cambiato
                        if (!edit || e.currentTarget.contains(e.relatedTarget as Node)) return;
                        setTimeout(() => {
                          if (document.activeElement?.closest(".roster-group.inline-edit")) return;
                          if (editRef.current?.id === p.id) void saveEdit();
                        }, 0);
                      }}
                      onKeyDown={(e) => {
                        if (!edit) return;
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditing(null);
                          setError(null);
                          table.current?.focus();
                        } else if (e.key === "Enter") {
                          // Invio salva e passa alla riga sotto (Maiusc: sopra), nello stesso campo
                          e.preventDefault();
                          void saveEdit(neighbour(e.shiftKey ? -1 : 1, edit.field));
                        }
                      }}
                    >
                      <span role="gridcell" className="roster-check">
                        <input
                          type="checkbox"
                          checked={picked.has(p.id)}
                          aria-label={t("Scegli {name}", { name: p.name })}
                          // Maiusc + clic: tutte le righe dall'ultima scelta a questa
                          onClick={(e) => pick(p.id, e.shiftKey)}
                          onChange={() => {}}
                        />
                      </span>
                      {edit ? (
                        <>
                          <span role="gridcell">
                            <input
                              className="roster-input"
                              value={edit.name}
                              maxLength={80}
                              autoFocus={edit.field === "name"}
                              onFocus={(e) => {
                                e.currentTarget.select();
                                setEditing({ ...edit, field: "name" });
                              }}
                              aria-label={t("Nome")}
                              onChange={(e) => setEditing({ ...edit, name: e.target.value })}
                            />
                          </span>
                          <span role="gridcell" className="col-email">
                            <input
                              className="roster-input"
                              type="email"
                              value={edit.email}
                              maxLength={120}
                              placeholder={t("Email")}
                              autoFocus={edit.field === "email"}
                              onFocus={(e) => {
                                e.currentTarget.select();
                                setEditing({ ...edit, field: "email" });
                              }}
                              aria-label={t("Email")}
                              onChange={(e) => setEditing({ ...edit, email: e.target.value })}
                            />
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            role="gridcell"
                            tabIndex={-1}
                            className="roster-name"
                            onDoubleClick={() => startEdit(p, "name")}
                            title={t("Doppio clic per correggere")}
                          >
                            {p.name}
                          </span>
                          <span
                            role="gridcell"
                            className="muted ellipsis col-email"
                            tabIndex={-1}
                            onDoubleClick={() => startEdit(p, "email")}
                            title={p.email ?? t("Doppio clic per aggiungere l'email")}
                          >
                            {p.email ?? ""}
                          </span>
                        </>
                      )}
                      <span role="gridcell" className="col-groups people-chips">
                        {own.slice(0, CHIPS).map((g) => (
                          <span key={g.id} className="people-chip" title={projectTitle(g.id, groups)}>
                            <button className="people-chip-main" onClick={() => setScope(g.id)}>
                              <ProjectDot project={g} />
                              <span className="ellipsis">{g.name}</span>
                            </button>
                            <button
                              className="people-chip-x"
                              aria-label={t("Togli {person} da «{name}»", { person: p.name, name: g.name })}
                              title={t("Togli da «{name}»", { name: g.name })}
                              disabled={busy}
                              onClick={() => void changeMembers(g, [], [p.name])}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {/* «+N» quando non stanno tutti: due chip nella pagina larga, uno in quella stretta */}
                        {[CHIPS - 1, CHIPS].map(
                          (n) =>
                            own.length > n && (
                              <span
                                key={n}
                                className={"people-more" + (n === CHIPS ? " wide" : " narrow")}
                                title={own
                                  .slice(n)
                                  .map((g) => projectTitle(g.id, groups))
                                  .join("\n")}
                              >
                                +{own.length - n}
                              </span>
                            ),
                        )}
                      </span>
                      <span role="gridcell" className="muted num">
                        {p.meetings > 0 ? (
                          <button
                            className="people-count"
                            onClick={() => onOpenPerson(p.name)}
                            title={t("Apri le note di {name} nella Libreria", { name: p.name })}
                          >
                            {p.meetings}
                          </button>
                        ) : (
                          "0"
                        )}
                      </span>
                      <span
                        role="gridcell"
                        className="muted col-last"
                        title={p.lastMeetingAt ? dayLabel(p.lastMeetingAt) : undefined}
                      >
                        {p.lastMeetingAt ? lastLabel(p.lastMeetingAt) : "—"}
                      </span>
                      <span role="gridcell" className="roster-acts">
                        {confirming === p.id ? (
                          <button
                            className="lib-act confirm"
                            autoFocus
                            onClick={() => void remove([p], p.id)}
                            onBlur={() => setConfirming((c) => (c === p.id ? null : c))}
                          >
                            {t("Rimuovere?")}
                          </button>
                        ) : (
                          <>
                            <button
                              className="lib-act"
                              onClick={() => startEdit(p)}
                              aria-label={t("Modifica {name}", { name: p.name })}
                              title={t(
                                "Cambia nome o email (anche con doppio clic): il nome nuovo arriva in tutte le note",
                              )}
                            >
                              ✎
                            </button>
                            <button
                              className="lib-act"
                              onClick={() => {
                                setEditing(null);
                                setError(null);
                                setMerging(merging?.id === p.id ? null : { id: p.id, into: null });
                              }}
                              aria-label={t("Unisci {name} a un'altra persona", { name: p.name })}
                              title={t("Unisci a un'altra persona: è la stessa, scritta in due modi")}
                              disabled={all.length < 2}
                            >
                              ⇢
                            </button>
                            <button
                              className="lib-act"
                              aria-label={t("Rimuovi {name}", { name: p.name })}
                              title={t("Toglie {name} dalla rubrica e dai gruppi: le note non cambiano", {
                                name: p.name,
                              })}
                              onClick={() => void remove([p], p.id)}
                            >
                              ×
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                    {error?.id === p.id && <p className="warn small roster-note">{error.text}</p>}
                    {edit && !error && (
                      <p className="muted small roster-note">
                        {t("Invio salva e passa alla riga sotto · Maiusc + Invio sopra · Esc annulla")}
                      </p>
                    )}
                    {merging?.id === p.id && (
                      <MergeRow
                        from={p}
                        people={all}
                        into={merging.into}
                        busy={busy}
                        error=""
                        onChoose={(into) => setMerging({ id: p.id, into })}
                        onMerge={(into) => merge(p, into)}
                        onCancel={() => {
                          setMerging(null);
                          setError(null);
                        }}
                      />
                    )}
                  </div>
                );
              })}
              {shown.length === 0 && (
                <p className="muted small roster-empty">
                  {q
                    ? t("Nessun risultato")
                    : group
                      ? t(
                          "Nessuno in questo gruppo: scrivi un nome qui sopra, incolla un elenco, o scegli più persone in «Tutte le persone».",
                        )
                      : t("Sono tutte in almeno un gruppo.")}
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {importing && (
        <VcardImport
          found={importing}
          group={group ?? undefined}
          onClose={() => setImporting(null)}
          onImported={(list, n) => {
            setImporting(null);
            setPeople(list);
            void api.listGroups().then(onGroupsChanged);
            toast(n === 1 ? t("1 persona aggiunta") : t("{n} persone aggiunte", { n }));
          }}
        />
      )}

      {dialog && (
        <GroupDialog
          group={dialog.mode === "edit" ? dialog.group : undefined}
          groups={groups}
          parentId={dialog.mode === "new" ? dialog.parentId : undefined}
          members={dialog.mode === "new" ? dialog.members : undefined}
          onClose={() => setDialog(null)}
          onSaved={(saved, list) => {
            const created = dialog.mode === "new";
            setDialog(null);
            onGroupsChanged(list);
            setScope(saved.id);
            if (created && dialog.members?.length) setPicked(new Set());
            void load();
          }}
        />
      )}
    </div>
  );
}
