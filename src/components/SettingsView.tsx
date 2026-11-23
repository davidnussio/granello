import { useEffect, useState } from "react";
import RecordingsSettings from "./RecordingsSettings";
import OnlineTranscription from "./OnlineTranscription";
import DemoButton, { type Demo } from "./DemoData";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText, on, SYSTEM_AUDIO, type AppInfo, type ModelDownload } from "../api";
import type { Settings, Vault, WhisperModelInfo } from "../types";
import VaultSettings from "./VaultSettings";
import PeopleSettings from "./PeopleSettings";
import SyncSettings from "./SyncSettings";
import AiSettings from "./AiSettings";
import CalendarSettings from "./CalendarSettings";
import { t } from "../i18n";
import TemplatesView from "./TemplatesView";
import { sectionLabel, type SettingsSection } from "./SettingsNav";
import { thisDevice } from "../platformText";
import { byOs } from "../platform";

interface Props {
  /** La sezione da mostrare: le sceglie la barra laterale delle impostazioni. */
  section: SettingsSection;
  toast: (t: string) => void;
  demo: Demo;
  vaults: Vault[];
  onVaultsChanged: (vaults: Vault[]) => void;
  onOpenVault: (id: string) => void;
  onCalendarChanged: () => void;
  onLangChanged: (setting: string) => void;
  onTimeFormatChanged: (setting: string) => void;
  /** Apre la Libreria sui meeting di una persona. */
  onOpenPerson: (name: string) => void;
}

const LANGS: [string, string][] = [
  ["it", "Italiano"],
  ["de", "Tedesco"],
  ["fr", "Francese"],
  ["en", "Inglese"],
  ["auto", "Rilevamento automatico"],
];

export default function SettingsView({
  section,
  toast,
  demo,
  vaults,
  onVaultsChanged,
  onOpenVault,
  onCalendarChanged,
  onLangChanged,
  onTimeFormatChanged,
  onOpenPerson,
}: Props) {
  const [savedAt, setSavedAt] = useState(0);
  const [s, setS] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [dl, setDl] = useState<Record<string, ModelDownload>>({});
  const [info, setInfo] = useState<AppInfo | null>(null);

  const loadModels = () => api.listWhisperModels().then(setModels);

  useEffect(() => {
    api
      .getSettings()
      .then(setS)
      .catch((e) => toast(errorText(e)));
    api
      .listAudioDevices()
      .then(setDevices)
      .catch(() => {});
    api
      .appInfo()
      .then(setInfo)
      .catch(() => {});
    loadModels().catch(() => {});
    return on("model-download", (d) => {
      setDl((x) => ({ ...x, [d.name]: d }));
      if (d.done) loadModels().catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // i template hanno la loro pagina, con il loro titolo e il loro editor a tutta area
  if (section === "templates") return <TemplatesView toast={toast} />;
  if (!s) return <div className="page muted">{t("Caricamento…")}</div>;

  const save = async (patch: Partial<Settings>): Promise<boolean> => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      setS(await api.saveSettings(next));
      if ("calendars" in patch) onCalendarChanged();
      if ("uiLanguage" in patch) onLangChanged(next.uiLanguage);
      if ("timeFormat" in patch) onTimeFormatChanged(next.timeFormat);
      // conferma discreta: le impostazioni si salvano da sole, senza un pulsante
      const stamp = Date.now();
      setSavedAt(stamp);
      setTimeout(() => setSavedAt((cur) => (cur === stamp ? 0 : cur)), 1600);
      return true;
    } catch (e) {
      toast(errorText(e));
      // valore rifiutato: si torna a quello realmente salvato
      api
        .getSettings()
        .then(setS)
        .catch(() => {});
      return false;
    }
  };

  const removeModel = async (name: string) => {
    try {
      await api.deleteWhisperModel(name);
      toast(t("Modello {name} eliminato", { name }));
    } catch (e) {
      toast(errorText(e));
    } finally {
      loadModels().catch(() => {});
    }
  };

  const download = async (name: string) => {
    setDl((x) => ({ ...x, [name]: { name, downloaded: 0, total: null, done: false } }));
    try {
      await api.downloadWhisperModel(name);
      toast(t("Modello {name} scaricato", { name }));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setDl((x) => {
        const { [name]: _, ...rest } = x;
        return rest;
      });
      loadModels().catch(() => {});
    }
  };

  return (
    <div className={"page settings" + (section === "people" ? " wide" : "")}>
      <h1 className="page-title">
        {sectionLabel(section)}
        <span className={"saved-flag" + (savedAt ? " on" : "")} aria-live="polite">
          {savedAt ? t("✓ Salvato") : ""}
        </span>
      </h1>

      {section === "profile" && (
        <>
          <section className="card">
            <h3>{t("Profilo")}</h3>
            <label className="field">
              <span>{t("Lingua dell'interfaccia")}</span>
              <select value={s.uiLanguage} onChange={(e) => save({ uiLanguage: e.target.value })}>
                <option value="system">{t("Come il sistema")}</option>
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="field">
              <span>{t("Formato dell'ora")}</span>
              <select value={s.timeFormat || "system"} onChange={(e) => save({ timeFormat: e.target.value })}>
                <option value="system">{t("Come il sistema")}</option>
                <option value="24">{t("24 ore (14:30)")}</option>
                <option value="12">{t("12 ore (2:30 PM)")}</option>
              </select>
            </label>
            <label className="field">
              <span>{t("Il tuo nome")}</span>
              <input
                value={s.userName}
                placeholder={t("Come comparire nella trascrizione")}
                onChange={(e) => setS({ ...s, userName: e.target.value })}
                onBlur={() => save({})}
              />
            </label>
          </section>
        </>
      )}
      {section === "ai" && (
        <>
          <AiSettings s={s} setS={setS} save={save} toast={toast} />
        </>
      )}
      {section === "transcription" && (
        <>
          <section className="card">
            <h3>{t("Trascrizione locale")}</h3>
            {!models.some((m) => m.name === s.whisperModel && m.downloaded) && (
              <p className="warn small">
                {t("Il modello selezionato non è ancora scaricato: senza non si può registrare.")}
              </p>
            )}
            <label className="field">
              <span>{t("Lingua del meeting")}</span>
              <select value={s.language} onChange={(e) => save({ language: e.target.value })}>
                {LANGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {t(l)}
                  </option>
                ))}
              </select>
              <small className="muted">
                {t("La lingua parlata nei meeting: guida la trascrizione e la lingua delle note AI.")}
              </small>
            </label>
            <div className="field">
              <span>{t("Modello Whisper")}</span>
              <div className="models">
                {models.map((m) => {
                  const d = dl[m.name];
                  const pct = d?.total ? Math.round((d.downloaded / d.total) * 100) : null;
                  return (
                    <div key={m.name} className={"model" + (s.whisperModel === m.name ? " selected" : "")}>
                      <label className="row gap">
                        <input
                          type="radio"
                          name="model"
                          aria-label={m.name}
                          checked={s.whisperModel === m.name}
                          onChange={() => save({ whisperModel: m.name })}
                        />
                        <span>
                          <strong>{m.name}</strong> <span className="muted small">{m.sizeMb} MB</span>
                          <br />
                          <span className="muted small">{m.description}</span>
                        </span>
                      </label>
                      {m.downloaded ? (
                        <span className="row gap">
                          <span className="ok small">{t("✓ scaricato")}</span>
                          <button
                            className="btn small ghost danger"
                            onClick={() => removeModel(m.name)}
                            title={t("Elimina il file del modello per liberare spazio")}
                          >
                            {t("Elimina")}
                          </button>
                        </span>
                      ) : d ? (
                        <span className="small mono">{pct !== null ? `${pct}%` : "…"}</span>
                      ) : (
                        <button className="btn small" onClick={() => download(m.name)}>
                          {t("Scarica")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
          <OnlineTranscription
            enabled={s.onlineTranscription}
            onChange={(onlineTranscription) => save({ onlineTranscription })}
            toast={toast}
          />
        </>
      )}
      {section === "audio" && (
        <>
          <section className="card">
            <h3>{t("Audio")}</h3>
            <label className="field">
              <span>{t("Microfono (la tua voce)")}</span>
              <select value={s.micDevice ?? ""} onChange={(e) => save({ micDevice: e.target.value || null })}>
                <option value="">{t("Predefinito di sistema")}</option>
                {devices.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("Audio degli altri partecipanti")}</span>
              <select
                value={s.systemDevice ?? ""}
                onChange={(e) => save({ systemDevice: e.target.value || null })}
              >
                <option value="">{t("Nessuno (solo microfono)")}</option>
                <option value={SYSTEM_AUDIO}>{t("Audio di sistema (consigliato)")}</option>
                {devices.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              <small className="muted">
                {t(
                  '"Audio di sistema" registra quello che esce dal computer (Teams, Zoom, Meet…) senza installare nulla. {requirement}"Microsoft Teams Audio" non contiene le voci della call. Con le cuffie eviti che il microfono riprenda anche gli altri.',
                  {
                    requirement: byOs(
                      t(
                        "Serve macOS 14.6 o successivo e, la prima volta, il permesso di registrare l'audio di sistema.",
                      ) + " ",
                      "",
                      t("Serve PulseAudio o PipeWire.") + " ",
                    ),
                  },
                )}
              </small>
            </label>
          </section>
          <RecordingsSettings settings={s} save={save} toast={toast} />
        </>
      )}
      {section === "calendar" && (
        <>
          <section className="card">
            <h3>{t("Calendario")}</h3>
            <CalendarSettings
              calendars={s.calendars}
              onSave={(calendars) => save({ calendars })}
              onShownChanged={onCalendarChanged}
              toast={toast}
            />
            <label className="field">
              <span>{t("Notifica prima dell'inizio (minuti)")}</span>
              <input
                type="number"
                min={1}
                max={60}
                value={s.notifyBeforeMin}
                onChange={(e) => setS({ ...s, notifyBeforeMin: Number(e.target.value) })}
                onBlur={() => save({})}
              />
            </label>
          </section>
        </>
      )}
      {section === "people" && (
        <PeopleSettings
          contacts={s.contactsSuggestions}
          onContactsChanged={(enabled) => save({ contactsSuggestions: enabled })}
          onOpenPerson={onOpenPerson}
          toast={toast}
        />
      )}
      {section === "vaults" && (
        <>
          <VaultSettings vaults={vaults} onChanged={onVaultsChanged} onOpen={onOpenVault} toast={toast} />
          <SyncSettings vaultId={vaults.find((v) => v.active)?.id ?? ""} toast={toast} />
        </>
      )}
      {section === "data" && (
        <>
          {info && (
            <section className="card">
              <h3>{t("Dati e privacy")}</h3>
              <p className="muted small">
                {t(
                  "Note, trascrizioni e modelli restano su {device}. L'audio non viene salvato: viene trascritto in locale e scartato. Fanno eccezione due opzioni, spente finché non le attivi: il salvataggio delle registrazioni, che tiene l'audio in una cartella di {device}, e la trascrizione online, che lo tiene fino al caricamento su Gladia e poi lo cancella. Al provider AI scelto vengono inviati solo il testo delle note e della trascrizione quando generi le note AI o usi la chat.",
                  { device: thisDevice() },
                )}
              </p>
              <div className="row gap">
                <button
                  className="btn small"
                  onClick={() => revealItemInDir(info.dataDir).catch((e) => toast(errorText(e)))}
                >
                  {byOs(
                    t("Mostra i dati nel Finder"),
                    t("Mostra i dati in Esplora file"),
                    t("Mostra la cartella dei dati"),
                  )}
                </button>
                {info.logDir && (
                  <button
                    className="btn small"
                    onClick={() => revealItemInDir(info.logDir).catch((e) => toast(errorText(e)))}
                  >
                    {t("Mostra i log")}
                  </button>
                )}
                <DemoButton demo={demo} />
                <div className="spacer" />
                <span className="muted small">Granello {info.version}</span>
              </div>
            </section>
          )}
          <section className="card">
            <h3>{t("Anteprime per sviluppatori")}</h3>
            <label className="row gap check">
              <input
                type="checkbox"
                checked={s.developerPreviews}
                onChange={(e) => save({ developerPreviews: e.target.checked })}
              />
              <span>{t("Mostra le funzioni ancora in anteprima")}</span>
            </label>
            <p className="muted small">
              {t(
                "Per ora c'è il sync tra i tuoi Mac, in Impostazioni → Vault. Le anteprime possono cambiare o sparire da una versione all'altra: provale solo con i dati di esempio.",
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
