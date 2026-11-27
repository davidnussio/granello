import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import type { Project } from "../types";
import { projectBranch, projectOptions } from "../tree";

/** I colori tra cui scegliere, con il nome che li descrive a chi non li vede. */
export const COLORS: { id: string; css: string; label: () => string }[] = [
  { id: "", css: "var(--accent)", label: () => t("Verde") },
  { id: "teal", css: "#2f9e9e", label: () => t("Turchese") },
  { id: "blue", css: "#4a86d9", label: () => t("Blu") },
  { id: "purple", css: "#8a63d2", label: () => t("Viola") },
  { id: "pink", css: "#d2639f", label: () => t("Rosa") },
  { id: "red", css: "#d9534f", label: () => t("Rosso") },
  { id: "orange", css: "#d98a1f", label: () => t("Arancione") },
  { id: "yellow", css: "#c9a227", label: () => t("Giallo") },
  { id: "gray", css: "#8a8a82", label: () => t("Grigio") },
];

/** Il colore CSS di un progetto; senza progetto, o con un colore sconosciuto, quello predefinito. */
export const projectColor = (p?: Pick<Project, "color">) =>
  COLORS.find((c) => c.id === p?.color)?.css ?? COLORS[0].css;

/** Il pallino colorato che accompagna il nome di un progetto negli elenchi. */
export function ProjectDot({ project }: { project: Pick<Project, "color"> }) {
  return <span className="project-dot" aria-hidden="true" style={{ background: projectColor(project) }} />;
}

interface Props {
  /** Il progetto da modificare; assente = se ne crea uno nuovo. */
  project?: Project;
  /** Tutti i progetti, per scegliere quello che contiene questo. */
  projects: Project[];
  /** Per un progetto nuovo: quello in cui nasce. */
  parentId?: string;
  onClose: () => void;
  /** Il progetto salvato e l'elenco aggiornato di tutti i progetti. */
  onSaved: (project: Project, all: Project[]) => void;
}

/** Finestra per creare un progetto o cambiarne nome, colore, descrizione e posizione. */
export default function ProjectDialog({ project, projects, parentId, onClose, onSaved }: Props) {
  const [name, setName] = useState(project?.name ?? "");
  const [parent, setParent] = useState(project?.parentId ?? parentId ?? "");
  // non dentro sé stesso né dentro uno dei suoi sotto-progetti
  const mine = project ? projectBranch(project.id, projects) : new Set<string>();
  const places = projectOptions(projects, parent).filter((p) => !mine.has(p.id));
  const [color, setColor] = useState(project?.color ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => nameInput.current?.focus(), []);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveProject({
        id: project?.id,
        name,
        color,
        description,
        parentId: parent || null,
      });
      onSaved(saved, await api.listProjects());
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
        // i tasti restano nella finestra: sotto c'è la Libreria, che si muove con le frecce
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <form
        className="modal project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={project ? t("Modifica il progetto") : t("Nuovo progetto")}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{project ? t("Modifica il progetto") : t("Nuovo progetto")}</h3>
        <label className="field">
          <span>{t("Nome")}</span>
          <input
            ref={nameInput}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Nome del progetto")}
          />
        </label>
        <label className="field">
          <span>{t("Dentro")}</span>
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">{t("Nessun progetto (primo livello)")}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span id="project-color-label">{t("Colore")}</span>
          <div className="project-colors" role="radiogroup" aria-labelledby="project-color-label">
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
            rows={3}
            value={description}
            maxLength={600}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("A cosa serve questo progetto")}
          />
        </label>
        {error && <p className="warn small">{error}</p>}
        <div className="project-buttons">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button className="btn" disabled={!name.trim() || busy}>
            {project ? t("Salva") : t("Crea")}
          </button>
        </div>
      </form>
    </div>
  );
}
