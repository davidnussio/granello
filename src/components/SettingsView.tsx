import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText, on, type AppInfo, type ModelDownload } from "../api";
import type { Settings, WhisperModelInfo } from "../types";

interface Props {
  toast: (t: string) => void;
  onCalendarChanged: () => void;
}

const LANGS: [string, string][] = [
  ["it", "Italiano"],
  ["de", "Tedesco"],
  ["fr", "Francese"],
  ["en", "Inglese"],
  ["auto", "Rilevamento automatico"],
];

export default function SettingsView({ toast, onCalendarChanged }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [dl, setDl] = useState<Record<string, ModelDownload>>({});
  const [info, setInfo] = useState<AppInfo | null>(null);

  const loadModels = () => api.listWhisperModels().then(setModels);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => toast(errorText(e)));
    api.listAudioDevices().then(setDevices).catch(() => {});
    api.hasApiKey().then(setHasKey).catch(() => {});
    api.appInfo().then(setInfo).catch(() => {});
    loadModels().catch(() => {});
    return on("model-download", (d) => {
      setDl((x) => ({ ...x, [d.name]: d }));
      if (d.done) loadModels().catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return <div className="page muted">Caricamento…</div>;

  const save = async (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      setS(await api.saveSettings(next));
      if ("icsUrl" in patch) onCalendarChanged();
    } catch (e) {
      toast(errorText(e));
      // valore rifiutato: si torna a quello realmente salvato
      api.getSettings().then(setS).catch(() => {});
    }
  };

  const removeModel = async (name: string) => {
    try {
      await api.deleteWhisperModel(name);
      toast(`Modello ${name} eliminato`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      loadModels().catch(() => {});
    }
  };

  const saveKey = async () => {
    try {
      await api.setApiKey(key);
      setKey("");
      setHasKey(await api.hasApiKey());
      toast(key ? "API key salvata" : "API key rimossa");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const download = async (name: string) => {
    setDl((x) => ({ ...x, [name]: { name, downloaded: 0, total: null, done: false } }));
    try {
      await api.downloadWhisperModel(name);
      toast(`Modello ${name} scaricato`);
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
      <h1 className="page-title">Impostazioni</h1>

      <section className="card">
        <h3>Claude</h3>
        <label className="field">
          <span>API key</span>
          <div className="row gap">
            <input
              type="password"
              value={key}
              placeholder={hasKey ? "•••••••••• salvata nel Portachiavi" : "sk-ant-…"}
              onChange={(e) => setKey(e.target.value)}
            />
            <button className="btn" onClick={saveKey} disabled={!key && !hasKey}>
              {key ? "Salva" : "Rimuovi"}
            </button>
          </div>
        </label>
        <label className="field">
          <span>Modello</span>
          <input value={s.claudeModel} onChange={(e) => setS({ ...s, claudeModel: e.target.value })} onBlur={() => save({})} />
          <small className="muted">Es. claude-sonnet-5-5 (default) o claude-opus-5-5 per note più curate.</small>
        </label>
        <label className="field">
          <span>Il tuo nome</span>
          <input
            value={s.userName}
            placeholder="Come comparire nella trascrizione"
            onChange={(e) => setS({ ...s, userName: e.target.value })}
            onBlur={() => save({})}
          />
        </label>
      </section>

      <section className="card">
        <h3>Trascrizione locale</h3>
        {!models.some((m) => m.name === s.whisperModel && m.downloaded) && (
          <p className="warn small">Il modello selezionato non è ancora scaricato: senza non si può registrare.</p>
        )}
        <label className="field">
          <span>Lingua del meeting</span>
          <select value={s.language} onChange={(e) => save({ language: e.target.value })}>
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Modello Whisper</span>
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
                      <span className="ok small">✓ scaricato</span>
                      <button
                        className="btn small ghost danger"
                        onClick={() => removeModel(m.name)}
                        title="Elimina il file del modello per liberare spazio"
                      >
                        Elimina
                      </button>
                    </span>
                  ) : d ? (
                    <span className="small mono">{pct !== null ? `${pct}%` : "…"}</span>
                  ) : (
                    <button className="btn small" onClick={() => download(m.name)}>
                      Scarica
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card">
        <h3>Audio</h3>
        <label className="field">
          <span>Microfono (la tua voce)</span>
          <select value={s.micDevice ?? ""} onChange={(e) => save({ micDevice: e.target.value || null })}>
            <option value="">Predefinito di sistema</option>
            {devices.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Audio degli altri partecipanti</span>
          <select value={s.systemDevice ?? ""} onChange={(e) => save({ systemDevice: e.target.value || null })}>
            <option value="">Nessuno (solo microfono)</option>
            {devices.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <small className="muted">
            Per catturare l'audio della call installa un dispositivo di loopback (es. BlackHole 2ch), crea in "Configurazione
            MIDI Audio" un dispositivo multi-uscita con cuffie + BlackHole e selezionalo come uscita di Teams/Zoom. Poi scegli
            BlackHole qui. Con le cuffie eviti che il microfono riprenda anche gli altri.
          </small>
        </label>
      </section>

      <section className="card">
        <h3>Calendario</h3>
        <label className="field">
          <span>URL iCal</span>
          <input
            value={s.icsUrl ?? ""}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            onChange={(e) => setS({ ...s, icsUrl: e.target.value })}
            onBlur={() => save({ icsUrl: s.icsUrl?.trim() || null })}
          />
          <small className="muted">
            Google Calendar: Impostazioni del calendario → "Indirizzo segreto in formato iCal". Outlook: Calendario →
            Pubblica calendario → link ICS.
          </small>
        </label>
        <label className="field">
          <span>Notifica prima dell'inizio (minuti)</span>
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
          <h3>Dati e privacy</h3>
          <p className="muted small">
            Note, trascrizioni e modelli restano su questo Mac. L'audio non viene salvato: viene trascritto in locale e
            scartato. A Claude vengono inviati solo il testo delle note e della trascrizione quando generi le note AI o
            usi la chat.
          </p>
          <div className="row gap">
            <button className="btn small" onClick={() => revealItemInDir(info.dataDir).catch((e) => toast(errorText(e)))}>
              Mostra i dati nel Finder
            </button>
            {info.logDir && (
              <button className="btn small" onClick={() => revealItemInDir(info.logDir).catch((e) => toast(errorText(e)))}>
                Mostra i log
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
