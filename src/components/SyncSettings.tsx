import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api";
import { dayLabel, time } from "../format";
import { t } from "../i18n";
import type { SyncStatus } from "../types";

interface Props {
  /** Il vault aperto: cambiando vault cambia anche il sync che si mostra. */
  vaultId: string;
  toast: (text: string) => void;
}

/**
 * Impostazioni → Vault: il sync del vault aperto attraverso una cartella. Fase 0, anteprima per
 * sviluppatori (Impostazioni → Dati e privacy): la cartella contiene note e trascrizioni in chiaro.
 */
export default function SyncSettings({ vaultId, toast }: Props) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .syncStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    // il sync gira da solo ogni pochi secondi: lo stato si aggiorna di conseguenza
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh, vaultId]);

  const run = async (action: () => Promise<SyncStatus | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await action();
      if (next) setStatus(next);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status?.available) return null;

  const choose = () =>
    run(async () => {
      const dir = await api.pickSyncDir();
      return dir ? api.enableSync(dir) : null;
    });

  return (
    <section className="card">
      <h3>{t("Sync tra i tuoi Mac")}</h3>
      <p className="warn small">
        {t(
          "Anteprima per sviluppatori: la cartella di sync contiene note e trascrizioni in chiaro. Provala solo con i dati di esempio.",
        )}
      </p>
      {status.blocked ? (
        <p className="muted small">{status.blocked}</p>
      ) : status.dir ? (
        <>
          <div className="vault-path muted small" title={status.dir}>
            {status.dir}
          </div>
          <p className="small">
            {[
              status.lastSync
                ? t("Ultimo sync: {when}", { when: `${dayLabel(status.lastSync)} ${time(status.lastSync)}` })
                : t("Non ancora sincronizzato"),
              t("Dispositivi: {n}", { n: status.devices }),
              status.pending > 0 ? t("Modifiche da inviare: {n}", { n: status.pending }) : "",
              status.conflicts > 0 ? t("Versioni di note tenute da parte: {n}", { n: status.conflicts }) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {status.error && <p className="warn small">{status.error}</p>}
          <div className="row gap">
            <button className="btn small" disabled={busy} onClick={() => run(api.syncNow)}>
              {busy ? t("Sincronizzo…") : t("Sincronizza ora")}
            </button>
            <div className="spacer" />
            <button className="btn small ghost" disabled={busy} onClick={() => run(api.disableSync)}>
              {t("Smetti di sincronizzare")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            {t(
              "Sincronizza il vault aperto con gli altri tuoi Mac attraverso una cartella, per esempio in iCloud Drive. Scegli una cartella vuota, oppure quella in cui un altro Mac sincronizza già questo vault.",
            )}
          </p>
          <button className="btn small" disabled={busy} onClick={choose}>
            {t("Scegli la cartella di sync…")}
          </button>
        </>
      )}
      <SyncHelp />
    </section>
  );
}

/** Come funziona il sync: cosa va nella cartella, cosa viaggia, come si aggiunge un altro Mac. */
function SyncHelp() {
  return (
    <details className="sync-help small">
      <summary>{t("Come funziona")}</summary>
      <p>
        {t(
          "Si sincronizza solo il vault aperto, non tutti. La cartella non è un vault: il vault resta dov'è, e nella cartella ogni Mac scrive le sue modifiche, che gli altri leggono e applicano. Per ogni campo vince la modifica più recente; se la stessa nota cambia su due Mac insieme, la versione rimasta indietro viene tenuta da parte.",
        )}
      </p>
      <ul>
        <li>
          <strong>{t("Viaggiano:")}</strong>{" "}
          {t("meeting con note, note AI, partecipanti e tag, trascrizioni, progetti e persone.")}
        </li>
        <li>
          <strong>{t("Non viaggiano:")}</strong>{" "}
          {t("audio, registrazioni e allegati (per ora), impostazioni, template, calendari e API key.")}
        </li>
        <li>
          <strong>{t("Mai:")}</strong>{" "}
          {t("i meeting blindati. Un vault con privacy minima blindata non si sincronizza.")}
        </li>
      </ul>
      <p>
        <strong>{t("Su un altro Mac")}</strong>
      </p>
      <ol>
        <li>{t("Accendi Impostazioni → Dati e privacy → Anteprime per sviluppatori.")}</li>
        <li>{t("Apri il vault che deve ricevere i dati, per esempio il Principale.")}</li>
        <li>{t("Qui, scegli la stessa cartella di sync.")}</li>
      </ol>
      <p>
        {t(
          "Il vault di quel Mac si unisce a questo: riceve i suoi meeting e manda i propri. Per tenerli separati, sull'altro Mac usa un vault nuovo e vuoto.",
        )}
      </p>
      <p>
        {t(
          "Ogni cartella appartiene a un solo vault. Per sincronizzare un altro vault, aprilo e scegli un'altra cartella vuota, per esempio Granello-Clienti accanto a questa.",
        )}
      </p>
    </details>
  );
}
