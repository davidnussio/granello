import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { t } from "../i18n";

/** Identificatore della chiave di Gladia, accanto a quelle dei provider AI. */
const KEY_ID = "gladia";

/**
 * Affinamento online della trascrizione: spento di default, perché è l'unico caso in cui
 * l'audio esce dal Mac. Serve una chiave di Gladia, che resta nel Portachiavi.
 */
export default function OnlineTranscription({
  enabled,
  onChange,
  toast,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  toast: (text: string) => void;
}) {
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  useEffect(() => {
    api.hasApiKey(KEY_ID).then(setHasKey).catch(() => {});
  }, []);

  const saveKey = async (value: string) => {
    try {
      await api.setApiKey(KEY_ID, value);
      setKey("");
      setHasKey(await api.hasApiKey(KEY_ID));
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <section className="card">
      <h3>{t("Trascrizione online con i parlanti")}</h3>
      <p className="muted small">
        {t("A fine riunione l'audio viene caricato su Gladia, che lo trascrive distinguendo chi parla; la trascrizione locale viene sostituita. Per farlo l'audio della riunione viene tenuto su questo Mac fino al caricamento e poi cancellato. Non vale per i meeting con privacy \"audio locale\" o \"blindata\", né finché ci sono parti da verificare.")}
      </p>
      <label className="row gap check">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{t("Affina la trascrizione online dopo la riunione")}</span>
      </label>
      {enabled && !hasKey && <p className="warn small">{t("Senza la chiave di Gladia l'audio non viene conservato e non parte niente.")}</p>}
      <label className="field">
        <span>{t("Chiave API di Gladia")}</span>
        <span className="row gap">
          <input
            type="password"
            value={key}
            placeholder={hasKey ? t("Chiave salvata nel Portachiavi") : t("Incolla la chiave")}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && saveKey(key)}
          />
          <button className="btn small" disabled={!key.trim()} onClick={() => saveKey(key)}>
            {t("Salva")}
          </button>
          {hasKey && (
            <button className="btn small" onClick={() => saveKey("")}>
              {t("Rimuovi")}
            </button>
          )}
        </span>
      </label>
    </section>
  );
}
