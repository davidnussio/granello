import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import type { Project } from "../types";

/** L'icona di un progetto che non ne ha scelta una. */
export const PROJECT_ICON = "▣";

/** Icona e nome di un progetto, come si mostrano negli elenchi. */
export const projectLabel = (p: Pick<Project, "icon" | "name">) => `${p.icon || PROJECT_ICON} ${p.name}`;

const ICONS = "📁 📌 🎯 🚀 💡 🧭 🤝 💼 🛠️ 📈 🧪 🎨 📣 🔒 🏠 🌱 📚 💬 🧾 ⭐".split(" ");

interface Props {
  /** Il progetto da modificare; assente = se ne crea uno nuovo. */
  project?: Project;
  onClose: () => void;
  /** Il progetto salvato e l'elenco aggiornato di tutti i progetti. */
  onSaved: (project: Project, all: Project[]) => void;
}

/** Finestra per creare un progetto o cambiarne nome, icona e descrizione. */
export default function ProjectDialog({ project, onClose, onSaved }: Props) {
  const [name, setName] = useState(project?.name ?? "");
  const [icon, setIcon] = useState(project?.icon ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => nameInput.current?.focus(), []);

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveProject({ id: project?.id, name, icon, description });
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
          <span>{t("Nome e icona")}</span>
          <span className="project-name">
            <button
              type="button"
              className="project-icon"
              aria-label={t("Scegli l'icona")}
              title={t("Scegli l'icona")}
              aria-expanded={picking}
              onClick={() => setPicking((v) => !v)}
            >
              {icon || PROJECT_ICON}
            </button>
            <input
              ref={nameInput}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Nome del progetto")}
            />
          </span>
        </label>
        {picking && (
          <div className="project-icons" role="group" aria-label={t("Scegli l'icona")}>
            {["", ...ICONS].map((i) => (
              <button
                key={i}
                type="button"
                className={i === icon ? "on" : ""}
                aria-pressed={i === icon}
                onClick={() => {
                  setIcon(i);
                  setPicking(false);
                }}
              >
                {i || PROJECT_ICON}
              </button>
            ))}
          </div>
        )}
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
