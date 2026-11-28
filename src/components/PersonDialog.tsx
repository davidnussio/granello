import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";
import type { Group, Person } from "../types";
import { projectTitle } from "../tree";
import ChipInput from "./ChipInput";
import { ProjectDot } from "./ProjectDialog";

interface Props {
  person: Person;
  groups: Group[];
  onClose: () => void;
  /** La rubrica aggiornata. */
  onSaved: (people: Person[]) => void;
  /** Apre un gruppo nella pagina Persone. */
  onOpenGroup: (id: string) => void;
}

const noSuggestions = async () => [];

/**
 * Tutti i dati di una persona: nome, email, ruolo e gli altri nomi con cui compare (un
 * soprannome, come la scrive il calendario). Gli altri nomi servono a riconoscerla: scritta così
 * tra i partecipanti, o arrivata così dal calendario, è lei.
 */
export default function PersonDialog({ person, groups, onClose, onSaved, onOpenGroup }: Props) {
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [role, setRole] = useState(person.role);
  const [aliases, setAliases] = useState<string[]>(person.aliases);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => nameInput.current?.select(), []);

  const member = groups.filter((g) => g.members.some((m) => m.toLowerCase() === person.name.toLowerCase()));

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await api.updatePerson(person.id, name, email.trim() || null, { role, aliases }));
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
      <form
        className="modal project-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={person.name}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>{person.name}</h3>
        <label className="field">
          <span>{t("Nome")}</span>
          <input ref={nameInput} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("Email")}</span>
          <input type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("Ruolo")}</span>
          <input
            value={role}
            maxLength={80}
            placeholder={t("Product owner, avvocato del cliente…")}
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <div className="field">
          <span>{t("Altri nomi")}</span>
          <div className="meta-row person-aliases">
            <ChipInput
              values={aliases}
              onChange={setAliases}
              suggest={noSuggestions}
              addLabel={t("+ Altro nome")}
              placeholder={t("Soprannome, iniziale…")}
            />
          </div>
          <p className="muted small">
            {t(
              "Scritta così tra i partecipanti, o arrivata così dal calendario, Granello la riconosce. Unendo due persone, il nome tolto finisce qui.",
            )}
          </p>
        </div>
        {member.length > 0 && (
          <div className="field">
            <span>{t("Gruppi")}</span>
            <div className="people-chips wrap">
              {member.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="people-chip"
                  title={projectTitle(g.id, groups)}
                  onClick={() => onOpenGroup(g.id)}
                >
                  <span className="people-chip-main">
                    <ProjectDot project={g} />
                    {g.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p className="warn small">{error}</p>}
        <div className="project-buttons">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("Annulla")}
          </button>
          <button className="btn" disabled={!name.trim() || busy}>
            {t("Salva")}
          </button>
        </div>
      </form>
    </div>
  );
}
