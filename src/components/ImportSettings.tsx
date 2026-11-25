import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "../api";
import { dayLabel, time } from "../format";
import { t } from "../i18n";
import type { ImportRecord, ImportSummary } from "../types";

interface Props {
  toast: (text: string) => void;
  /** Le note sono cambiate (importate o tolte): la barra laterale va riletta. */
  onMeetingsChanged: () => void;
  onOpenLibrary: () => void;
}

/** L'ultima parte di un percorso: il nome della cartella. */
const folderName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** Cosa farebbe l'import: quante note e file, i progetti, cosa resta fuori. */
function Summary({ summary }: { summary: ImportSummary }) {
  const s = summary;
  return (
    <>
      {!s.obsidian && (
        <p className="warn small">
          {t(
            "In questa cartella non c'è la cartella .obsidian: forse non è un vault. Puoi importarla lo stesso, come una cartella di file Markdown.",
          )}
        </p>
      )}
      <ul className="import-counts small">
        <li>
          <strong>{s.notes}</strong> {s.notes === 1 ? t("nota da importare") : t("note da importare")}
        </li>
        <li>
          <strong>{s.attachments}</strong> {t("file usati dalle note, copiati come allegati")}
        </li>
        <li>
          <strong>{s.loose}</strong> {t("file che nessuna nota usa, in Libreria → File")}
        </li>
        {s.already > 0 && (
          <li>
            <strong>{s.already}</strong> {t("note già importate, saltate")}
          </li>
        )}
      </ul>
      {s.projects.length > 0 && (
        <p className="small">
          {t("Progetti dalle cartelle (ogni sottocartella è un progetto dentro quello sopra):")}{" "}
          {s.projects.join(", ")}
        </p>
      )}
      {s.missingLinks > 0 && (
        <p className="muted small">
          {t(
            "{n} link portano a note che non ci sono: restano link, segnati come mancanti, e funzionano appena crei una nota con quel titolo.",
            { n: s.missingLinks },
          )}
        </p>
      )}
      {s.changed.length > 0 && (
        <details className="import-details small">
          <summary>
            {t("{n} note cambiate in Obsidian dopo l'ultimo import: non vengono aggiornate", {
              n: s.changed.length,
            })}
          </summary>
          <ul>
            {s.changed.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      {s.skipped.length > 0 && (
        <details className="import-details small">
          <summary>{t("{n} elementi lasciati fuori", { n: s.skipped.length })}</summary>
          <ul>
            {s.skipped.map((x) => (
              <li key={x.path + x.reason}>
                {x.path} <span className="muted">— {x.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * Impostazioni → Importa da. Per ora una fonte, Obsidian: si sceglie il vault, si vede cosa
 * arriverebbe, si importa. Ogni import resta in elenco e si può annullare.
 */
export default function ImportSettings({ toast, onMeetingsChanged, onOpenLibrary }: Props) {
  const [dir, setDir] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState<"scan" | "import" | string | null>(null);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      api
        .listImports()
        .then(setImports)
        .catch((e) => toast(errorText(e))),
    [toast],
  );
  useEffect(() => void reload(), [reload]);

  const scan = async (path: string) => {
    setBusy("scan");
    setSummary(null);
    try {
      setSummary(await api.scanObsidian(path));
      setDir(path);
    } catch (e) {
      setDir(null);
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const choose = async () => {
    try {
      const picked = await api.pickImportDir();
      if (picked) await scan(picked);
    } catch (e) {
      toast(errorText(e));
    }
  };

  const run = async () => {
    if (!dir) return;
    setBusy("import");
    try {
      const done = await api.importObsidian(dir);
      setDir(null);
      setSummary(null);
      onMeetingsChanged();
      await reload();
      toast(
        done.files > 0
          ? t("Importate {n} note e {f} file senza nota.", { n: done.notes, f: done.files })
          : t("Importate {n} note.", { n: done.notes }),
      );
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const undo = async (rec: ImportRecord) => {
    if (confirm !== rec.id) {
      setConfirm(rec.id);
      return;
    }
    setConfirm(null);
    setBusy(rec.id);
    try {
      const n = await api.undoImport(rec.id);
      onMeetingsChanged();
      await reload();
      toast(t("Import annullato: tolte {n} note.", { n }));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const nothingNew = summary !== null && summary.notes === 0 && summary.loose === 0;

  return (
    <>
      <section className="card import-source">
        <h3>Obsidian</h3>
        <p className="muted small">
          {t(
            "Copia le note di un vault Obsidian nel vault aperto. Il vault Obsidian viene solo letto: non cambia niente. Le immagini e i file che le note usano diventano allegati, i link [[…]] collegano le note tra loro, le cartelle di primo livello diventano progetti e ogni nota riceve il tag #obsidian. Niente viene inviato a un modello AI.",
          )}
        </p>
        {dir && (
          <div className="vault-path muted small" title={dir}>
            {dir}
          </div>
        )}
        {busy === "scan" && <p className="muted small">{t("Leggo la cartella…")}</p>}
        {summary && <Summary summary={summary} />}
        {nothingNew && (
          <p className="small">{t("Non c'è niente di nuovo da importare in questa cartella.")}</p>
        )}
        <div className="row gap">
          {summary && !nothingNew ? (
            <>
              <button className="btn small primary" disabled={busy !== null} onClick={() => void run()}>
                {busy === "import"
                  ? t("Importo…")
                  : summary.notes === 1
                    ? t("Importa 1 nota")
                    : t("Importa {n} note", { n: summary.notes })}
              </button>
              <button
                className="btn small ghost"
                disabled={busy !== null}
                onClick={() => {
                  setDir(null);
                  setSummary(null);
                }}
              >
                {t("Annulla")}
              </button>
            </>
          ) : (
            <button className="btn small" disabled={busy !== null} onClick={() => void choose()}>
              {t("Scegli il vault Obsidian…")}
            </button>
          )}
        </div>
      </section>

      {imports.length > 0 && (
        <section className="card">
          <h3>{t("Import fatti")}</h3>
          <ul className="import-list">
            {imports.map((rec) => (
              <li key={rec.id} className="import-row">
                <div className="import-main">
                  <span className="import-title" title={rec.root}>
                    Obsidian · {folderName(rec.root)}
                  </span>
                  <span className="muted small">
                    {dayLabel(rec.createdAt)} {time(rec.createdAt)} ·{" "}
                    {rec.notes === 1 ? t("1 nota") : t("{n} note", { n: rec.notes })}
                    {rec.files > 0 && ` · ${t("{n} file senza nota", { n: rec.files })}`}
                  </span>
                </div>
                <button className="btn small ghost" onClick={onOpenLibrary}>
                  {t("Libreria")}
                </button>
                <button
                  className={"btn small ghost" + (confirm === rec.id ? " danger" : "")}
                  disabled={busy !== null}
                  onClick={() => void undo(rec)}
                  title={t(
                    "Elimina le note e i file arrivati con questo import, anche se li hai modificati dopo",
                  )}
                >
                  {busy === rec.id
                    ? t("Annullo…")
                    : confirm === rec.id
                      ? t("Eliminare {n} note?", { n: rec.notes })
                      : t("Annulla import")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
