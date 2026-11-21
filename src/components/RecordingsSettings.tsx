import { useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, errorText } from "../api";
import type { RecordingsInfo, Settings } from "../types";
import { t } from "../i18n";
import { thisDevice } from "../platformText";
import { byOs } from "../platform";

/** Salvataggio delle registrazioni: se tenerle, in quale cartella, e se togliere le pause. */
export default function RecordingsSettings({
  settings,
  save,
  toast,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>) => Promise<boolean>;
  toast: (text: string) => void;
}) {
  const [info, setInfo] = useState<RecordingsInfo | null>(null);
  const load = () =>
    api
      .recordingsInfo()
      .then(setInfo)
      .catch(() => {});
  useEffect(() => {
    load();
  }, [settings.recordingsDir]);

  const choose = async () => {
    try {
      const dir = await api.pickRecordingsDir();
      if (dir && (await save({ recordingsDir: dir }))) load();
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <section className="card">
      <h3>{t("Registrazioni")}</h3>
      <p className="muted small">
        {t(
          "Di norma l'audio viene trascritto e scartato. Attivando il salvataggio, l'audio di ogni riunione resta in una cartella di {device} e si riascolta dalla Libreria o dal meeting. Non viene inviato a nessuno.",
          { device: thisDevice() },
        )}
      </p>
      <label className="row gap check">
        <input
          type="checkbox"
          checked={settings.saveRecordings}
          onChange={(e) => save({ saveRecordings: e.target.checked })}
        />
        <span>{t("Salva le registrazioni")}</span>
      </label>
      <label className="field">
        <span>{t("Cartella")}</span>
        <span className="row gap">
          <code className="rec-dir" title={info?.dir}>
            {info?.dir ?? "…"}
          </code>
          <button className="btn small" onClick={choose}>
            {t("Cambia…")}
          </button>
          {settings.recordingsDir && (
            <button
              className="btn small"
              onClick={() => save({ recordingsDir: null })}
              title={info?.defaultDir}
            >
              {t("Predefinita")}
            </button>
          )}
          {info && (
            <button
              className="btn small"
              onClick={() => revealItemInDir(info.dir).catch((e) => toast(errorText(e)))}
            >
              {byOs(t("Mostra nel Finder"), t("Mostra in Esplora file"), t("Mostra la cartella"))}
            </button>
          )}
        </span>
      </label>
      <p className="muted small">
        {t("Cambiando cartella, le registrazioni già fatte restano dov'erano e si continuano a riascoltare.")}
      </p>
      <label className="row gap check">
        <input
          type="checkbox"
          checked={settings.trimSilence}
          disabled={info !== null && !info.ffmpeg}
          onChange={(e) => save({ trimSilence: e.target.checked })}
        />
        <span>{t("Togli le pause senza audio alla fine della registrazione")}</span>
      </label>
      <p className="muted small">
        {info && !info.ffmpeg
          ? t(
              "Serve ffmpeg, che su {device} non c'è (si installa con: {install}). Senza, le registrazioni restano in WAV, circa 115 MB all'ora.",
              {
                device: thisDevice(),
                install: byOs("brew install ffmpeg", "winget install Gyan.FFmpeg", "sudo apt install ffmpeg"),
              },
            )
          : t(
              "Con ffmpeg le registrazioni vengono compresse (circa 20 MB all'ora). Togliendo le pause, i minuti dell'audio non corrispondono più a quelli della trascrizione.",
            )}
      </p>
    </section>
  );
}
