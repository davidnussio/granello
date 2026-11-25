import { t } from "../i18n";

/** Le sezioni delle impostazioni, nell'ordine in cui compaiono nella barra laterale. */
const SECTIONS = [
  { id: "profile", icon: "☺", label: () => t("Profilo"), group: "app" },
  { id: "ai", icon: "✦", label: () => t("Modelli AI"), group: "app" },
  { id: "transcription", icon: "❝", label: () => t("Trascrizione"), group: "app" },
  { id: "audio", icon: "◉", label: () => t("Audio e registrazioni"), group: "app" },
  { id: "calendar", icon: "▦", label: () => t("Calendario"), group: "app" },
  { id: "templates", icon: "☰", label: () => t("Template"), group: "app" },
  { id: "people", icon: "☻", label: () => t("Persone"), group: "data" },
  { id: "vaults", icon: "◫", label: () => t("Vault"), group: "data" },
  { id: "import", icon: "⇣", label: () => t("Importa da"), group: "data" },
  { id: "data", icon: "▣", label: () => t("Dati e privacy"), group: "data" },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]["id"];

export const DEFAULT_SECTION: SettingsSection = "profile";

export const sectionLabel = (id: SettingsSection) => SECTIONS.find((s) => s.id === id)!.label();

interface Props {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  /** Torna alla vista da cui si erano aperte le impostazioni. */
  onBack: () => void;
}

/** La barra laterale mentre si è nelle impostazioni: al posto dei meeting, le sezioni. */
export default function SettingsNav({ section, onSection, onBack }: Props) {
  const group = (name: (typeof SECTIONS)[number]["group"]) =>
    SECTIONS.filter((s) => s.group === name).map((s) => (
      <button
        key={s.id}
        className={"nav-item settings-item" + (s.id === section ? " active" : "")}
        aria-current={s.id === section ? "page" : undefined}
        onClick={() => onSection(s.id)}
      >
        <span className="settings-icon" aria-hidden="true">
          {s.icon}
        </span>
        {s.label()}
      </button>
    ));
  return (
    <aside className="sidebar settings-nav">
      <div className="sidebar-top">
        <button className="nav-item settings-back" onClick={onBack}>
          {t("← Torna alle note")}
        </button>
        <h2 className="settings-heading">{t("Impostazioni")}</h2>
      </div>
      <nav className="nav" aria-label={t("Impostazioni")}>
        {group("app")}
        <h4 className="settings-group">{t("Dati")}</h4>
        {group("data")}
      </nav>
    </aside>
  );
}
