import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { Template } from "../types";
import { t } from "../i18n";
import NoteEditor from "../editor/NoteEditor";
import { defaultPlugins } from "../editor";

const EMPTY: Template = { id: "", name: "", description: "", instructions: "", builtin: false, notesMd: "" };

// i blocchi che vivono di un meeting vero (trascrizione, registrazione, AI sul meeting) qui non servono
const TEMPLATE_PLUGINS = defaultPlugins.filter((p) => !["ai", "moment", "transcriptQuote"].includes(p.name));

export default function TemplatesView({ toast }: { toast: (text: string) => void }) {
  const [list, setList] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);

  const load = () =>
    api
      .listTemplates()
      .then(setList)
      .catch((e) => toast(errorText(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!edit) return;
    try {
      const saved = await api.saveTemplate(edit);
      toast(edit.builtin ? t("Salvata una copia: {name}", { name: saved.name }) : t("Template salvato"));
      setEdit(null);
      load();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const remove = async (tpl: Template) => {
    await api.deleteTemplate(tpl.id).catch((e) => toast(errorText(e)));
    setEdit(null);
    load();
  };

  // la modifica prende tutta l'area: a sinistra le istruzioni per l'AI, a destra le note di partenza
  if (edit) {
    return (
      <div className="tpl-edit">
        <header className="tpl-edit-head">
          <h1 className="page-title">
            {edit.id
              ? edit.builtin
                ? t("{name} (modifica = copia)", { name: edit.name })
                : t("Modifica template")
              : t("Nuovo template")}
          </h1>
          <div className="spacer" />
          {edit.id && !edit.builtin && (
            <button className="btn ghost danger" onClick={() => remove(edit)}>
              {t("Elimina")}
            </button>
          )}
          <button className="btn ghost" onClick={() => setEdit(null)}>
            {t("Annulla")}
          </button>
          <button className="btn primary" onClick={save}>
            {edit.builtin ? t("Salva come copia") : t("Salva")}
          </button>
        </header>
        <div className="tpl-edit-meta">
          <label className="field">
            <span>{t("Nome")}</span>
            <input
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              placeholder={t("Es. Retro di sprint")}
            />
          </label>
          <label className="field">
            <span>{t("Descrizione")}</span>
            <input
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </label>
        </div>
        <div className="tpl-edit-cols">
          <label className="field tpl-edit-col">
            <span>{t("Istruzioni per l'AI")}</span>
            <small className="muted">{t("Come l'AI deve strutturare le note AI di questo meeting.")}</small>
            <textarea
              value={edit.instructions}
              onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
              placeholder={t("Usa queste sezioni:\n### Cosa è andato bene\n### Cosa migliorare\n### Azioni")}
            />
          </label>
          <div className="field tpl-edit-col">
            <span>{t("Note di partenza")}</span>
            <small className="muted">
              {t(
                "Ciò che trovi già scritto nelle tue note quando scegli questo template su un meeting vuoto.",
              )}
            </small>
            <div className="tpl-edit-notes">
              <NoteEditor
                docKey={"template:" + (edit.id || "nuovo")}
                value={edit.notesMd}
                plugins={TEMPLATE_PLUGINS}
                placeholder={t("Un'agenda, i titoli delle sezioni, una checklist… Digita / per i comandi.")}
                onChange={(notesMd) => setEdit((current) => (current ? { ...current, notesMd } : current))}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="row">
        <h1 className="page-title">{t("Template")}</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
          {t("+ Nuovo template")}
        </button>
      </div>
      <p className="muted">
        {t(
          "Il template dice all'AI come strutturare le note AI e può dare alle tue note un punto di partenza. Si sceglie per ogni meeting dall'intestazione.",
        )}
      </p>

      <div className="tpl-grid">
        {list.map((tpl) => (
          <button key={tpl.id} className="tpl-card" onClick={() => setEdit({ ...tpl })}>
            <strong>{tpl.name}</strong>
            {tpl.builtin && <span className="chip tiny">{t("di sistema")}</span>}
            {tpl.notesMd.trim() && <span className="chip tiny">{t("con note di partenza")}</span>}
            <span className="muted small">{tpl.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
