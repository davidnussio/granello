import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import type { Group } from "../types";
import { projectTitle } from "../tree";
import { ProjectDot } from "./ProjectDialog";

interface Props {
  /** I gruppi della nota (id). */
  groupIds: string[];
  attendees: string[];
  groups: Group[];
  /** Cambia gruppi e partecipanti insieme: aggiungere un team porta dentro anche i suoi membri. */
  onChange: (patch: { groupIds?: string[]; attendees?: string[] }) => void;
  /** Apre il gruppo nella pagina Persone. */
  onOpenGroup: (id: string) => void;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Come in backend: i partecipanti di una nota. */
const MAX_ATTENDEES = 100;

/**
 * I gruppi presenti a una nota, accanto ai partecipanti. Un team porta con sé i membri come
 * partecipanti; un pubblico (tutta l'azienda) resta un chip solo. Un clic sul chip mostra i
 * membri e lascia scegliere chi c'era.
 */
export default function MeetingGroups({ groupIds, attendees, groups, onChange, onOpenGroup }: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const present = groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is Group => !!g);
  const has = (name: string) => attendees.some((a) => same(a, name));

  const q = text.trim().toLowerCase();
  const options = groups
    .filter((g) => !groupIds.includes(g.id) && (!q || g.name.toLowerCase().includes(q)))
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);

  /**
   * Un team i cui membri sono già tutti tra i partecipanti: lo si propone, come gli invitati
   * del calendario.
   */
  const suggested = useMemo(
    () =>
      groups.find(
        (g) =>
          g.kind === "team" &&
          g.members.length >= 2 &&
          !groupIds.includes(g.id) &&
          g.members.every((m) => attendees.some((a) => same(a, m))),
      ),
    [groups, groupIds, attendees],
  );

  const add = (g: Group) => {
    setText("");
    setAdding(false);
    const patch: { groupIds: string[]; attendees?: string[] } = { groupIds: [...groupIds, g.id] };
    if (g.kind === "team") {
      const missing = g.members.filter((m) => !has(m));
      if (missing.length) patch.attendees = [...attendees, ...missing].slice(0, MAX_ATTENDEES);
    }
    onChange(patch);
  };

  const toggleMember = (name: string) =>
    onChange({
      attendees: has(name)
        ? attendees.filter((a) => !same(a, name))
        : [...attendees, name].slice(0, MAX_ATTENDEES),
    });

  return (
    <>
      {present.map((g) => (
        <GroupChip
          key={g.id}
          group={g}
          groups={groups}
          open={openId === g.id}
          present={g.members.filter(has).length}
          has={has}
          onToggle={() => setOpenId((now) => (now === g.id ? null : g.id))}
          onClose={() => setOpenId(null)}
          onRemove={() => {
            setOpenId(null);
            onChange({ groupIds: groupIds.filter((id) => id !== g.id) });
          }}
          onToggleMember={toggleMember}
          onAll={(on) =>
            onChange({
              attendees: on
                ? [...attendees, ...g.members.filter((m) => !has(m))].slice(0, MAX_ATTENDEES)
                : attendees.filter((a) => !g.members.some((m) => same(m, a))),
            })
          }
          onOpenGroup={() => onOpenGroup(g.id)}
        />
      ))}
      {suggested && !adding && (
        <button
          type="button"
          className="chip import"
          title={t("Ci sono tutti i membri di «{name}»: aggiungi il gruppo alla nota", {
            name: suggested.name,
          })}
          onClick={() => add(suggested)}
        >
          {t("+ {name}", { name: suggested.name })}
        </button>
      )}
      {groups.length > 0 &&
        (adding ? (
          <span className="chip-field">
            <input
              autoFocus
              value={text}
              placeholder={t("Nome del gruppo")}
              aria-label={t("Nome del gruppo")}
              spellCheck={false}
              onChange={(e) => {
                setText(e.target.value);
                setSelected(0);
              }}
              onBlur={() => {
                setAdding(false);
                setText("");
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && options.length) {
                  e.preventDefault();
                  setSelected((i) => (i + 1) % options.length);
                } else if (e.key === "ArrowUp" && options.length) {
                  e.preventDefault();
                  setSelected((i) => (i <= 0 ? options.length - 1 : i - 1));
                } else if (e.key === "Enter" || e.key === "Tab") {
                  if (!options[selected]) return;
                  e.preventDefault();
                  add(options[selected]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(false);
                  setText("");
                }
              }}
            />
            <span className="chip-menu" role="listbox">
              {options.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  className={"chip-option" + (i === selected ? " on" : "")}
                  onMouseEnter={() => setSelected(i)}
                  // mousedown: il click farebbe perdere il fuoco al campo prima di aggiungere
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(g);
                  }}
                >
                  <ProjectDot project={g} />
                  <span className="chip-option-name">{projectTitle(g.id, groups)}</span>
                  <span className="chip-option-hint">
                    {g.kind === "team"
                      ? t("team · {n}", { n: g.members.length })
                      : t("pubblico · {n}", { n: g.members.length })}
                  </span>
                </button>
              ))}
              {options.length === 0 && (
                <span className="chip-option muted">
                  {q ? t("Nessun gruppo con questo nome") : t("Ci sono già tutti")}
                </span>
              )}
            </span>
          </span>
        ) : (
          <button type="button" className="chip add" onClick={() => setAdding(true)}>
            {t("+ Gruppo")}
          </button>
        ))}
    </>
  );
}

function GroupChip({
  group,
  groups,
  open,
  present,
  has,
  onToggle,
  onClose,
  onRemove,
  onToggleMember,
  onAll,
  onOpenGroup,
}: {
  group: Group;
  groups: Group[];
  open: boolean;
  /** Quanti membri sono tra i partecipanti. */
  present: number;
  has: (name: string) => boolean;
  onToggle: () => void;
  onClose: () => void;
  onRemove: () => void;
  onToggleMember: (name: string) => void;
  onAll: (on: boolean) => void;
  onOpenGroup: () => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [filter, setFilter] = useState("");

  // un clic fuori chiude l'elenco dei membri
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, onClose]);

  const q = filter.trim().toLowerCase();
  const members = group.members.filter((m) => !q || m.toLowerCase().includes(q));
  const count = group.members.length;
  const summary =
    group.kind === "team"
      ? t("{n} di {total} presenti", { n: present, total: count })
      : count === 1
        ? t("1 membro")
        : t("{n} membri", { n: count });

  return (
    <span className="group-chip-wrap" ref={box}>
      <span className={"chip group" + (group.kind === "audience" ? " audience" : "")}>
        <button
          type="button"
          className="group-chip-main"
          aria-expanded={open}
          aria-haspopup="dialog"
          title={`${projectTitle(group.id, groups)} · ${summary}`}
          onClick={onToggle}
        >
          <ProjectDot project={group} />
          <span className="group-chip-name">{group.name}</span>
          <span className="group-chip-count">{count}</span>
        </button>
        <button
          type="button"
          className="chip-x"
          aria-label={t("Togli il gruppo {name}", { name: group.name })}
          title={t("Togli il gruppo dalla nota: i partecipanti restano")}
          onClick={onRemove}
        >
          ×
        </button>
      </span>
      {open && (
        <div
          className="group-pop"
          role="dialog"
          aria-label={group.name}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
        >
          <div className="group-pop-head">
            <strong>{projectTitle(group.id, groups)}</strong>
            <span className="muted small">{summary}</span>
          </div>
          <p className="muted small group-pop-hint">
            {group.kind === "team"
              ? t("Togli la spunta a chi non c'era.")
              : t("Spunta chi ha parlato o va citato: diventa un partecipante della nota.")}
          </p>
          {count > 8 && (
            <input
              className="search group-pop-search"
              type="search"
              autoFocus
              value={filter}
              placeholder={t("Cerca nel gruppo")}
              aria-label={t("Cerca nel gruppo")}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          <div className="group-pop-list">
            {members.map((m) => (
              <label key={m} className="group-pop-item">
                <input type="checkbox" checked={has(m)} onChange={() => onToggleMember(m)} />
                <span className="ellipsis">{m}</span>
              </label>
            ))}
            {count === 0 && <p className="muted small">{t("Il gruppo non ha ancora membri.")}</p>}
            {count > 0 && members.length === 0 && <p className="muted small">{t("Nessun risultato")}</p>}
          </div>
          <div className="group-pop-foot">
            {count > 0 && group.kind === "team" && (
              <button type="button" className="btn small ghost" onClick={() => onAll(present < count)}>
                {present < count ? t("Tutti presenti") : t("Nessuno")}
              </button>
            )}
            <div className="spacer" />
            <button type="button" className="btn small ghost" onClick={onOpenGroup}>
              {t("Apri il gruppo")}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
