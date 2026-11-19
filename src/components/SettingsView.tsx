import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText, on, type AppInfo, type ModelDownload } from "../api";
import type { Settings, WhisperModelInfo } from "../types";
import AiSettings from "./AiSettings";
import { t } from "../i18n";

interface Props {
  toast: (t: string) => void;
  onCalendarChanged: () => void;
  onLangChanged: (setting: string) => void;
}

const LANGS: [string, string][] = [
  ["it", "Italiano"],
  ["de", "Tedesco"],
  ["fr", "Francese"],
  ["en", "Inglese"],
  ["auto", "Rilevamento automatico"],
];

export default function SettingsView({ toast, onCalendarChanged, onLangChanged }: Props) {
  const [savedAt, setSavedAt] = useState(0);
  const [s, setS] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [dl, setDl] = useState<Record<string, ModelDownload>>({});
  const [info, setInfo] = useState<AppInfo | null>(null);

  const loadModels = () => api.listWhisperModels().then(setModels);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => toast(errorText(e)));
    api.listAudioDevices().then(setDevices).catch(() => {});
    api.appInfo().then(setInfo).catch(() => {});
    loadModels().catch(() => {});
    return on("model-download", (d) => {
      setDl((x) => ({ ...x, [d.name]: d }));
      if (d.done) loadModels().catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return <div className="page muted">{t("Caricamento…")}</div>;

  const save = async (patch: Partial<Settings>): Promise<boolean> => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      setS(await api.saveSettings(next));
      if ("icsUrl" in patch) onCalendarChanged();
      if ("uiLanguage" in patch) onLangChanged(next.uiLanguage);
      // conferma discreta: le impostazioni si salvano da sole, senza un pulsante
      const stamp = Date.now();
      setSavedAt(stamp);
      setTimeout(() => setSavedAt((cur) => (cur === stamp ? 0 : cur)), 1600);
      return true;
    } catch (e) {
      toast(errorText(e));
      // valore rifiutato: si torna a quello realmente salvato
      api.getSettings().then(setS).catch(() => {});
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
    <div className="page settings">
      <h1 className="page-title">
        {t("Impostazioni")}
        <span className={"saved-flag" + (savedAt ? " on" : "")} aria-live="polite">
          {savedAt ? t("✓ Salvato") : ""}
        </span>
      </h1>

      <AiSettings s={s} setS={setS} save={save} toast={toast} />

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
          <span>{t("Il tuo nome")}</span>
          <input
            value={s.userName}
            placeholder={t("Come comparire nella trascrizione")}
            onChange={(e) => setS({ ...s, userName: e.target.value })}
            onBlur={() => save({})}
          />
        </label>
      </section>

      <section className="card">
        <h3>{t("Trascrizione locale")}</h3>
        {!models.some((m) => m.name === s.whisperModel && m.downloaded) && (
          <p className="warn small">{t("Il modello selezionato non è ancora scaricato: senza non si può registrare.")}</p>
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
          <select value={s.systemDevice ?? ""} onChange={(e) => save({ systemDevice: e.target.value || null })}>
            <option value="">{t("Nessuno (solo microfono)")}</option>
            {devices.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <small className="muted">
            {t("Per catturare l'audio della call installa un dispositivo di loopback (es. BlackHole 2ch), crea in \"Configurazione MIDI Audio\" un dispositivo multi-uscita con cuffie + BlackHole e selezionalo come uscita di Teams/Zoom. Poi scegli BlackHole qui. Con le cuffie eviti che il microfono riprenda anche gli altri.")}
          </small>
        </label>
      </section>

      <section className="card">
        <h3>{t("Calendario")}</h3>
        <label className="field">
          <span>{t("URL iCal")}</span>
          <input
            // l'indirizzo iCal è un segreto: resta nascosto, come una password
            type="password"
            autoComplete="off"
            value={s.icsUrl ?? ""}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            onChange={(e) => setS({ ...s, icsUrl: e.target.value })}
            onBlur={() => save({ icsUrl: s.icsUrl?.trim() || null })}
          />
          <small className="muted">
            {t("Google Calendar: Impostazioni del calendario → \"Indirizzo segreto in formato iCal\". Outlook: Calendario → Pubblica calendario → link ICS.")}
          </small>
        </label>
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

      {info && (
        <section className="card">
          <h3>{t("Dati e privacy")}</h3>
          <p className="muted small">
            {t("Note, trascrizioni e modelli restano su questo Mac. L'audio non viene salvato: viene trascritto in locale e scartato. Al provider AI scelto vengono inviati solo il testo delle note e della trascrizione quando generi le note AI o usi la chat.")}
          </p>
          <div className="row gap">
            <button className="btn small" onClick={() => revealItemInDir(info.dataDir).catch((e) => toast(errorText(e)))}>
              {t("Mostra i dati nel Finder")}
            </button>
            {info.logDir && (
              <button className="btn small" onClick={() => revealItemInDir(info.logDir).catch((e) => toast(errorText(e)))}>
                {t("Mostra i log")}
              </button>
            )}
            <div className="spacer" />
            <span className="muted small">Granello {info.version}</span>
          </div>
        </section>
      )}
    </div>
  );
}
