import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import { TEAM_SIZE, type Group, type GroupKind } from "../types";
import { groupOptions, projectBranch } from "../tree";
import { COLORS } from "./ProjectDialog";

interface Props {
  /** Il gruppo da modificare; assente = se ne crea uno nuovo. */
  group?: Group;
  /** Tutti i gruppi, per scegliere quello che contiene questo. */
  groups: Group[];
  /** Per un gruppo nuovo: quello in cui nasce. */
  parentId?: string;
  /** Per un gruppo nuovo: le persone che ne fanno già parte (la selezione della pagina Persone). */
  members?: string[];
  onClose: () => void;
  /** Il gruppo salvato e l'elenco aggiornato di tutti i gruppi. */
  onSaved: (group: Group, all: Group[]) => void;
}

/** Spiegazione breve di un tipo di gruppo, la stessa nella finestra e nella pagina Persone. */
export const kindHint = (kind: GroupKind) =>
  kind === "team"
    ? t("Aggiungendolo a una nota entrano anche i suoi membri come partecipanti.")
    : t("Nella nota resta un solo chip: dei membri aggiungi solo chi serve.");

/** Finestra per creare un gruppo o cambiarne nome, posizione, tipo, colore e descrizione. */
export default function GroupDialog({ group, groups, parentId, members, onClose, onSaved }: Props) {
  const [name, setName] = useState(group?.name ?? "");
  const [parent, setParent] = useState(group?.parentId ?? parentId ?? "");
  // non dentro sé stesso né dentro uno dei gruppi che contiene
  const mine = group ? projectBranch(group.id, groups) : new Set<string>();
  const places = groupOptions(groups).filter((g) => !mine.has(g.id));
  const size = group?.members.length ?? members?.length ?? 0;
  const [kind, setKind] = useState<GroupKind>(group?.kind ?? (size > TEAM_SIZE ? "audience" : "team"));
  const [color, setColor] = useState(group?.color ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => nameInput.current?.focus(), []);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveGroup({
        id: group?.id,
        name,
        color,
        description,
        parentId: parent || null,
        kind,
        members: group?.members ?? members ?? [],
      });
      onSaved(saved, await api.listGroups());
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const title = group ? t("Modifica il gruppo") : t("Nuovo gruppo");
  return (
    <div
      className="modal-bg"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        // i tasti restano nella finestra: sotto c'è la pagina Persone, che si muove con le frecce
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <form
        className="modal project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{title}</h3>
        {!group && members && members.length > 0 && (
          <p className="muted small">
            {members.length === 1
              ? t("Con 1 persona già dentro.")
              : t("Con {n} persone già dentro.", { n: members.length })}
          </p>
        )}
        <label className="field">
          <span>{t("Nome")}</span>
          <input
            ref={nameInput}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Team, reparto, cliente…")}
          />
        </label>
        <label className="field">
          <span>{t("Dentro")}</span>
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">{t("Nessun gruppo (primo livello)")}</option>
            {places.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="field group-kinds">
          <legend>{t("Nelle note")}</legend>
          {(["team", "audience"] as const).map((k) => (
            <label key={k} className="group-kind">
              <input
                type="radio"
                name="group-kind"
                checked={kind === k}
                aria-label={k === "team" ? t("Team") : t("Pubblico")}
                onChange={() => setKind(k)}
              />
              <span>
                <strong>{k === "team" ? t("Team") : t("Pubblico")}</strong>
                <span className="muted small">{kindHint(k)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <span id="group-color-label">{t("Colore")}</span>
          <div className="project-colors" role="radiogroup" aria-labelledby="group-color-label">
            {COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.id === color}
                aria-label={c.label()}
                title={c.label()}
                className={c.id === color ? "on" : ""}
                style={{ background: c.css }}
                onClick={() => setColor(c.id)}
              />
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t("Descrizione")}</span>
          <textarea
            rows={2}
            value={description}
            maxLength={600}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("Chi ne fa parte, a cosa serve")}
          />
        </label>
        {error && <p className="warn small">{error}</p>}
        <div className="project-buttons">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button className="btn" disabled={!name.trim() || busy}>
            {group ? t("Salva") : t("Crea")}
          </button>
        </div>
      </form>
    </div>
  );
}
