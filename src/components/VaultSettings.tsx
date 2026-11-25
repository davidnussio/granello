import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText } from "../api";
import { t } from "../i18n";
import { byOs } from "../platform";
import { thisDevice } from "../platformText";
import type { Privacy, Vault } from "../types";

interface Props {
  vaults: Vault[];
  onChanged: (vaults: Vault[]) => void;
  /** Apre un vault: l'app passa a mostrare i suoi meeting. */
  onOpen: (id: string) => void;
  toast: (text: string) => void;
}

/** Il livello sotto cui i meeting di un vault non possono scendere. */
function MinPrivacy({
  value,
  onChange,
  label,
}: {
  value: Privacy;
  onChange: (p: Privacy) => void;
  label: string;
}) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as Privacy)}>
      <option value="open">{t("Nessun minimo")}</option>
      <option value="audio">{t("Almeno audio locale")}</option>
      <option value="hardened">{t("Sempre blindata")}</option>
    </select>
  );
}

/** Impostazioni → Vault: dove stanno i dati, e con quale privacy minima. */
export default function VaultSettings({ vaults, onChanged, onOpen, toast }: Props) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [minPrivacy, setMinPrivacy] = useState<Privacy>("hardened");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Il vault di cui si è chiesto di confermare la rimozione dall'elenco. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const run = async (action: () => Promise<Vault[]>) => {
    try {
      onChanged(await action());
      return true;
    } catch (e) {
      toast(errorText(e));
      return false;
    }
  };

  const pick = async () => {
    try {
      const chosen = await api.pickVaultDir();
      if (chosen) setPath(chosen);
    } catch (e) {
      toast(errorText(e));
    }
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onChanged(await api.createVault(name, path, minPrivacy));
      setName("");
      setPath("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const reveal = byOs(t("Mostra nel Finder"), t("Mostra in Esplora file"), t("Mostra la cartella"));

  return (
    <>
      <section className="card">
        <p className="muted small">
          {t(
            "Un vault è una cartella con il suo database, i suoi allegati e le sue registrazioni: le note di un vault esistono solo lì. Mettilo su un disco cifrato o esterno per tenere separate le note riservate. Se ne apre uno alla volta: elenco, Libreria, ricerca e chat mostrano solo quello aperto. Impostazioni, template e chiavi restano su {device} e valgono per tutti.",
            { device: thisDevice() },
          )}
        </p>
        <div className="vault-list">
          {vaults.map((v) => (
            <div key={v.id} className={"vault" + (v.active ? " active" : "")}>
              <div className="vault-head">
                {v.main ? (
                  <span className="vault-name">{v.name}</span>
                ) : (
                  <input
                    className="vault-name"
                    defaultValue={v.name}
                    maxLength={60}
                    aria-label={t("Nome del vault")}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === v.name) e.target.value = v.name;
                      else
                        void run(() => api.updateVault(v.id, next, v.minPrivacy)).then((ok) => {
                          if (!ok) e.target.value = v.name;
                        });
                    }}
                  />
                )}
                {v.active ? (
                  <span className="chip vault-open">{t("Aperto")}</span>
                ) : v.available ? (
                  <button className="btn small" onClick={() => onOpen(v.id)}>
                    {t("Apri")}
                  </button>
                ) : (
                  <span className="warn small">{t("Non disponibile: collega il disco")}</span>
                )}
              </div>
              <div className="vault-path muted small" title={v.path}>
                {v.path}
              </div>
              <div className="vault-row">
                <label className="vault-privacy">
                  <span className="small">{t("Privacy minima")}</span>
                  <MinPrivacy
                    value={v.minPrivacy}
                    label={t("Privacy minima del vault {name}", { name: v.name })}
                    onChange={(p) => void run(() => api.updateVault(v.id, v.name, p))}
                  />
                </label>
                <div className="spacer" />
                {v.available && (
                  <button
                    className="btn small ghost"
                    onClick={() => revealItemInDir(v.path).catch((e) => toast(errorText(e)))}
                  >
                    {reveal}
                  </button>
                )}
                {!v.main && !v.active && (
                  <button
                    className={"btn small ghost" + (confirmRemove === v.id ? " danger" : "")}
                    title={t("Toglie il vault dall'elenco: la cartella e i suoi dati restano dove sono")}
                    onBlur={() => setConfirmRemove(null)}
                    onClick={() => {
                      if (confirmRemove !== v.id) setConfirmRemove(v.id);
                      else {
                        setConfirmRemove(null);
                        void run(() => api.removeVault(v.id));
                      }
                    }}
                  >
                    {confirmRemove === v.id ? t("Confermi?") : t("Togli dall'elenco")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="muted small">
          {t(
            "Alzare la privacy minima alza subito le note del vault che stavano sotto, e non si possono più riabbassare finché il minimo resta. Blindata: niente esce da {device}, ogni funzione AI usa solo un modello locale.",
            { device: thisDevice() },
          )}
        </p>
      </section>

      <section className="card">
        <h3>{t("Nuovo vault")}</h3>
        <label className="field">
          <span>{t("Nome")}</span>
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Es. Clienti riservati")}
          />
        </label>
        <div className="field">
          <span>{t("Cartella")}</span>
          <div className="row gap">
            <span className={"vault-path small" + (path ? "" : " muted")} title={path}>
              {path || t("Nessuna cartella scelta")}
            </span>
            <div className="spacer" />
            <button className="btn small" onClick={pick}>
              {t("Scegli…")}
            </button>
          </div>
          <small className="muted">
            {t(
              "Una cartella vuota per un vault nuovo, oppure quella di un vault che esiste già (anche creato su un altro computer): Granello ritrova le sue note.",
            )}
          </small>
        </div>
        <label className="field">
          <span>{t("Privacy minima")}</span>
          <MinPrivacy value={minPrivacy} label={t("Privacy minima")} onChange={setMinPrivacy} />
        </label>
        {error && <p className="warn small">{error}</p>}
        <button className="btn primary small" disabled={!name.trim() || !path || busy} onClick={create}>
          {t("Aggiungi il vault")}
        </button>
      </section>
    </>
  );
}
