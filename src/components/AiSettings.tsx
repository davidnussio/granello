import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { ModelRef, Provider, Settings } from "../types";
import { t } from "../i18n";

interface Props {
  s: Settings;
  setS: (s: Settings) => void;
  save: (patch: Partial<Settings>) => Promise<boolean>;
  toast: (t: string) => void;
}

const ANTHROPIC = "anthropic";

const PRESETS: { label: string; name: string; id: string; baseUrl: string }[] = [
  { label: "LM Studio", name: "LM Studio", id: "lmstudio", baseUrl: "http://localhost:1234/v1" },
  { label: "Ollama", name: "Ollama", id: "ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "OpenAI", name: "OpenAI", id: "openai", baseUrl: "https://api.openai.com/v1" },
  { label: "Altro", name: "Server personalizzato", id: "custom", baseUrl: "http://localhost:8080/v1" },
];

function isLocal(url: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url);
}

export default function AiSettings({ s, setS, save, toast }: Props) {
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [checking, setChecking] = useState<string | null>(null);

  const ids = s.providers.map((p) => p.id).join(",");
  useEffect(() => {
    s.providers.forEach((p) =>
      api
        .hasApiKey(p.id)
        .then((v) => setHasKey((x) => ({ ...x, [p.id]: v })))
        .catch(() => {}),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const provider = (id: string) => s.providers.find((p) => p.id === id);

  /** Chiede al provider l'elenco dei modelli. `quiet`: non segnala gli errori (caricamento automatico). */
  const loadModels = async (p: Provider, quiet = false): Promise<string[]> => {
    setChecking(p.id);
    try {
      const list = await api.listProviderModels(p);
      setModels((x) => ({ ...x, [p.id]: list }));
      if (!quiet)
        toast(
          list.length
            ? t("{name}: {n} modelli disponibili", { name: p.name, n: list.length })
            : t("{name} non ha modelli caricati", { name: p.name }),
        );
      return list;
    } catch (e) {
      if (!quiet) toast(`${p.name}: ${errorText(e)}`);
      return [];
    } finally {
      setChecking(null);
    }
  };

  const patchProvider = (id: string, patch: Partial<Provider>) =>
    setS({ ...s, providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const addProvider = async (preset: (typeof PRESETS)[number]) => {
    let id = preset.id;
    for (let n = 2; s.providers.some((p) => p.id === id); n++) id = `${preset.id}-${n}`;
    const p: Provider = { id, name: t(preset.name), kind: "openai", baseUrl: preset.baseUrl, contextTokens: null };
    if (await save({ providers: [...s.providers, p] })) loadModels(p, true);
  };

  const removeProvider = async (id: string) => {
    const fallback = (m: ModelRef): ModelRef =>
      m.providerId === id ? { providerId: ANTHROPIC, model: "claude-sonnet-5-5" } : m;
    await save({
      providers: s.providers.filter((p) => p.id !== id),
      notesModel: fallback(s.notesModel),
      chatModel: fallback(s.chatModel),
    });
  };

  const saveKey = async (p: Provider) => {
    const key = keyDraft[p.id] ?? "";
    try {
      await api.setApiKey(p.id, key);
      setKeyDraft((x) => ({ ...x, [p.id]: "" }));
      setHasKey((x) => ({ ...x, [p.id]: !!key }));
      api.hasApiKey(p.id).then((v) => setHasKey((x) => ({ ...x, [p.id]: v })));
      toast(key ? t("API key salvata nel Portachiavi") : t("API key rimossa"));
    } catch (e) {
      toast(errorText(e));
    }
  };

  const picker = (label: string, field: "notesModel" | "chatModel", hint: string) => {
    const ref = s[field];
    const list = models[ref.providerId] ?? [];
    const listId = `models-${field}`;
    const changeProvider = async (providerId: string) => {
      const p = provider(providerId);
      if (!p) return;
      // il modello va riscelto: quelli del provider precedente qui non esistono
      setS({ ...s, [field]: { providerId, model: "" } });
      const available = models[providerId] ?? (await loadModels(p, true));
      const model = providerId === ANTHROPIC ? "claude-sonnet-5-5" : (available[0] ?? "");
      if (model) await save({ [field]: { providerId, model } });
      else toast(t("Scrivi il nome del modello di {name}", { name: p.name }));
    };
    return (
      <div className="field">
        <span>{label}</span>
        <div className="row gap">
          <select
            className="provider-select"
            value={ref.providerId}
            aria-label={t("Provider per {label}", { label })}
            onChange={(e) => changeProvider(e.target.value)}
          >
            {s.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            value={ref.model}
            list={listId}
            placeholder={t("Nome del modello")}
            aria-label={t("Modello per {label}", { label })}
            spellCheck={false}
            onFocus={() => {
              const p = provider(ref.providerId);
              if (p && !models[p.id]) loadModels(p, true);
            }}
            onChange={(e) => setS({ ...s, [field]: { ...ref, model: e.target.value } })}
            onBlur={() => ref.model.trim() && save({})}
          />
          <datalist id={listId}>
            {list.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <small className="muted">{hint}</small>
      </div>
    );
  };

  return (
    <section className="card">
      <h3>{t("Modelli AI")}</h3>
      {picker(t("Note AI"), "notesModel", t("Scrive le note arricchite: conta la qualità, conviene il modello migliore che hai."))}
      {picker(t("Chat"), "chatModel", t("Risponde alle domande sui meeting: può essere un modello più piccolo o locale."))}

      <h4 className="sub">{t("Provider")}</h4>
      {s.providers.map((p) => {
        const builtin = p.id === ANTHROPIC;
        const draft = keyDraft[p.id] ?? "";
        const saved = hasKey[p.id];
        return (
          <div key={p.id} className="provider">
            <div className="row gap">
              <input
                className="provider-name"
                value={p.name}
                disabled={builtin}
                aria-label={t("Nome del provider")}
                onChange={(e) => patchProvider(p.id, { name: e.target.value })}
                onBlur={() => save({})}
              />
              <span className="chip tiny">{p.kind === "anthropic" ? "Anthropic" : t("Compatibile OpenAI")}</span>
              <div className="spacer" />
              <button className="btn small" onClick={() => loadModels(p)} disabled={checking === p.id}>
                {checking === p.id ? t("Verifico…") : t("Verifica")}
              </button>
              {!builtin && (
                <button className="btn small ghost danger" onClick={() => removeProvider(p.id)}>
                  {t("Rimuovi")}
                </button>
              )}
            </div>
            {p.kind === "openai" && (
              <div className="row gap">
                <label className="field grow">
                  <span>{t("Indirizzo")}</span>
                  <input
                    value={p.baseUrl}
                    placeholder="http://localhost:1234/v1"
                    spellCheck={false}
                    onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
                    onBlur={() => save({})}
                  />
                </label>
                <label className="field ctx">
                  <span>{t("Contesto (token)")}</span>
                  <input
                    type="number"
                    min={0}
                    step={1024}
                    value={p.contextTokens ?? ""}
                    placeholder={t("non impostato")}
                    onChange={(e) => patchProvider(p.id, { contextTokens: Number(e.target.value) || null })}
                    onBlur={() => save({})}
                  />
                </label>
              </div>
            )}
            <label className="field">
              <span>{t("API key")}</span>
              <div className="row gap">
                <input
                  type="password"
                  value={draft}
                  placeholder={
                    saved
                      ? t("•••••••••• salvata nel Portachiavi")
                      : builtin
                        ? "sk-ant-…"
                        : t("Non serve per i server locali")
                  }
                  onChange={(e) => setKeyDraft((x) => ({ ...x, [p.id]: e.target.value }))}
                />
                <button className="btn" onClick={() => saveKey(p)} disabled={!draft && !saved}>
                  {draft ? t("Salva") : t("Rimuovi")}
                </button>
              </div>
            </label>
            {p.kind === "openai" && isLocal(p.baseUrl) && (
              <small className="muted">
                {t("Resta tutto su questo Mac. I server locali troncano in silenzio i testi più lunghi del contesto del modello (Ollama parte con un contesto ridotto): indica qui il contesto impostato sul server e Granello ti avvisa prima di inviare un meeting che non ci sta.")}
              </small>
            )}
            {p.kind === "openai" && p.baseUrl.startsWith("http://") && !isLocal(p.baseUrl) && (
              <small className="warn">
                {t("Indirizzo non cifrato (http) verso un altro computer: note e trascrizioni viaggiano in chiaro sulla rete.")}
              </small>
            )}
          </div>
        );
      })}
      <div className="row gap add-provider">
        <span className="muted small">{t("Aggiungi:")}</span>
        {PRESETS.map((preset) => (
          <button key={preset.id} className="btn small" onClick={() => addProvider(preset)}>
            + {t(preset.label)}
          </button>
        ))}
      </div>
    </section>
  );
}
