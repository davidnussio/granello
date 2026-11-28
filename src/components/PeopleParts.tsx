import { useState } from "react";
import { api, errorText } from "../api";
import type { Group, ImportedPerson, Person } from "../types";
import { t } from "../i18n";

/** Pezzi della pagina Persone: unione di due persone, import da vCard. */

export function MergeRow({
  from,
  people,
  into,
  busy,
  error,
  onChoose,
  onMerge,
  onCancel,
}: {
  from: Person;
  people: Person[];
  into: number | null;
  busy: boolean;
  error: string;
  onChoose: (id: number | null) => void;
  onMerge: (into: Person) => void;
  onCancel: () => void;
}) {
  const others = people.filter((p) => p.id !== from.id).toSorted((a, b) => a.name.localeCompare(b.name));
  const target = others.find((p) => p.id === into) ?? null;
  return (
    <div className="roster-merge">
      <span>{t("{name} è la stessa persona di", { name: from.name })}</span>
      <select
        className="chip select"
        value={into ?? ""}
        autoFocus
        aria-label={t("Persona con cui unire {name}", { name: from.name })}
        onChange={(e) => onChoose(e.target.value ? Number(e.target.value) : null)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <option value="">{t("Scegli…")}</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {target && (
        <span className="muted small">
          {from.meetings === 1
            ? t("1 nota passa a {into}; {from} sparisce dalla rubrica.", {
                into: target.name,
                from: from.name,
              })
            : t("{n} note passano a {into}; {from} sparisce dalla rubrica.", {
                n: from.meetings,
                into: target.name,
                from: from.name,
              })}
        </span>
      )}
      <div className="spacer" />
      <button className="btn small ghost" onClick={onCancel}>
        {t("Annulla")}
      </button>
      <button className="btn small" disabled={!target || busy} onClick={() => target && onMerge(target)}>
        {t("Unisci")}
      </button>
      {error && <p className="warn small roster-note">{error}</p>}
    </div>
  );
}

export function VcardImport({
  found,
  group,
  onClose,
  onImported,
}: {
  found: ImportedPerson[];
  /** Il gruppo aperto nella pagina Persone: chi si importa può entrarci subito. */
  group?: Group;
  onClose: () => void;
  onImported: (all: Person[], added: number) => void;
}) {
  // chi è già in rubrica parte senza spunta; gli altri tutti spuntati se sono pochi
  const fresh = found.filter((p) => !p.known);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    new Set(fresh.length <= 50 ? fresh.map((p) => p.name) : []),
  );
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intoGroup, setIntoGroup] = useState(!!group);
  /** Il file aveva una colonna dei gruppi: i gruppi che mancano si creano. */
  const withGroups = found.some((p) => p.groups?.length);
  const q = filter.trim().toLowerCase();
  const listed = found.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q),
  );

  const toggle = (name: string) => {
    const next = new Set(picked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const chosen = found.filter((p) => picked.has(p.name));
      const all = await api.addPeople(chosen);
      if (group && intoGroup)
        await api.changeGroupMembers(
          group.id,
          chosen.map((p) => p.name),
          [],
        );
      onImported(all, chosen.filter((p) => !p.known).length);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-bg"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="modal vcard-dialog" role="dialog" aria-modal="true" aria-label={t("Importa persone")}>
        <h3>{t("Importa persone")}</h3>
        <p className="muted small">
          {t(
            "Scegli chi aggiungere alla rubrica di Granello: le proporrà tra i partecipanti. Chi c'è già riceve email e ruolo, se non li aveva.",
          )}
          {withGroups &&
            " " +
              t(
                "I gruppi della colonna Gruppo che non ci sono ancora vengono creati (`Azienda/Vendite` sta dentro `Azienda`).",
              )}
        </p>
        <div className="roster-tools">
          <input
            className="search"
            type="search"
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("Cerca per nome o email")}
            aria-label={t("Cerca per nome o email")}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setPicked(new Set([...picked, ...listed.map((p) => p.name)]))}
          >
            {t("Seleziona tutti")}
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              const next = new Set(picked);
              for (const p of listed) next.delete(p.name);
              setPicked(next);
            }}
          >
            {t("Nessuno")}
          </button>
        </div>
        <div className="vcard-list">
          {listed.map((p) => (
            <label key={p.name} className="vcard-item">
              <input type="checkbox" checked={picked.has(p.name)} onChange={() => toggle(p.name)} />
              <span className="roster-name">
                {p.name}
                {p.role && <span className="muted small"> · {p.role}</span>}
              </span>
              <span className="muted small ellipsis">
                {p.email ?? ""}
                {p.groups?.length ? ` · ${p.groups.join(", ")}` : ""}
              </span>
              {p.known && <span className="chip small-chip">{t("già in rubrica")}</span>}
            </label>
          ))}
          {listed.length === 0 && <p className="muted small roster-empty">{t("Nessun risultato")}</p>}
        </div>
        {group && (
          <label className="row gap check">
            <input type="checkbox" checked={intoGroup} onChange={(e) => setIntoGroup(e.target.checked)} />
            <span>{t("Aggiungile anche al gruppo «{name}»", { name: group.name })}</span>
          </label>
        )}
        {error && <p className="warn small">{error}</p>}
        <div className="project-buttons">
          <span className="muted small">
            {t("{n} di {total} scelti", { n: picked.size, total: found.length })}
          </span>
          <div className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button className="btn" disabled={picked.size === 0 || busy} onClick={add}>
            {picked.size === 1 ? t("Aggiungi 1 persona") : t("Aggiungi {n} persone", { n: picked.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
