import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import type { Template } from "../types";

const EMPTY: Template = { id: "", name: "", description: "", instructions: "", builtin: false };

export default function TemplatesView({ toast }: { toast: (t: string) => void }) {
  const [list, setList] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);

  const load = () => api.listTemplates().then(setList).catch((e) => toast(errorText(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!edit) return;
    try {
      const saved = await api.saveTemplate(edit);
      toast(edit.builtin ? `Salvata una copia: ${saved.name}` : "Template salvato");
      setEdit(null);
      load();
    } catch (e) {
      toast(errorText(e));
    }
  };

  const remove = async (t: Template) => {
    await api.deleteTemplate(t.id).catch((e) => toast(errorText(e)));
    setEdit(null);
    load();
  };

  return (
    <div className="page">
      <div className="row">
        <h1 className="page-title">Template</h1>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEdit({ ...EMPTY })}>
          + Nuovo template
        </button>
      </div>
      <p className="muted">
        Il template dice a Claude come strutturare le note AI. Si sceglie per ogni meeting dall'intestazione.
      </p>

      <div className="tpl-grid">
        {list.map((t) => (
          <button key={t.id} className="tpl-card" onClick={() => setEdit({ ...t })}>
            <strong>{t.name}</strong>
            {t.builtin && <span className="chip tiny">di sistema</span>}
            <span className="muted small">{t.description}</span>
          </button>
        ))}
      </div>

      {edit && (
        <div className="modal-bg" onClick={() => setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id ? (edit.builtin ? `${edit.name} (modifica = copia)` : "Modifica template") : "Nuovo template"}</h3>
            <label className="field">
              <span>Nome</span>
              <input
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                placeholder="Es. Retro di sprint"
              />
            </label>
            <label className="field">
              <span>Descrizione</span>
              <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </label>
            <label className="field">
              <span>Istruzioni per Claude</span>
              <textarea
                rows={10}
                value={edit.instructions}
                onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
                placeholder={"Usa queste sezioni:\n### Cosa è andato bene\n### Cosa migliorare\n### Azioni"}
              />
            </label>
            <div className="row gap">
              {edit.id && !edit.builtin && (
                <button className="btn ghost danger" onClick={() => remove(edit)}>
                  Elimina
                </button>
              )}
              <div className="spacer" />
              <button className="btn ghost" onClick={() => setEdit(null)}>
                Annulla
              </button>
              <button className="btn primary" onClick={save}>
                {edit.builtin ? "Salva come copia" : "Salva"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
