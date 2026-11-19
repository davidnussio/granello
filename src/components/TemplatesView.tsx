import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { Template } from "../types";
import { t } from "../i18n";

const EMPTY: Template = { id: "", name: "", description: "", instructions: "", builtin: false };

export default function TemplatesView({ toast }: { toast: (text: string) => void }) {
  const [list, setList] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);

  const load = () => api.listTemplates().then(setList).catch((e) => toast(errorText(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc chiude la finestra di modifica
  useEffect(() => {
    if (!edit) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setEdit(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit]);

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
        {t("Il template dice all'AI come strutturare le note AI. Si sceglie per ogni meeting dall'intestazione.")}
      </p>

      <div className="tpl-grid">
        {list.map((tpl) => (
          <button key={tpl.id} className="tpl-card" onClick={() => setEdit({ ...tpl })}>
            <strong>{tpl.name}</strong>
            {tpl.builtin && <span className="chip tiny">{t("di sistema")}</span>}
            <span className="muted small">{tpl.description}</span>
          </button>
        ))}
      </div>

      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? (edit.builtin ? t("{name} (modifica = copia)", { name: edit.name }) : t("Modifica template")) : t("Nuovo template")}</h3>
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
              <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("Istruzioni per l'AI")}</span>
              <textarea
                rows={10}
                value={edit.instructions}
                onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
                placeholder={t("Usa queste sezioni:\n### Cosa è andato bene\n### Cosa migliorare\n### Azioni")}
              />
            </label>
            <div className="row gap">
              {edit.id && !edit.builtin && (
                <button className="btn ghost danger" onClick={() => remove(edit)}>
                  {t("Elimina")}
                </button>
              )}
              <div className="spacer" />
              <button className="btn ghost" onClick={() => setEdit(null)}>
                {t("Annulla")}
              </button>
              <button className="btn primary" onClick={save}>
                {edit.builtin ? t("Salva come copia") : t("Salva")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
