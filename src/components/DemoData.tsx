import { useState } from "react";
import { t } from "../i18n";

/** I dati di esempio visti dall'interfaccia: quanti meeting sono caricati e come metterli o toglierli. */
export interface Demo {
  count: number;
  load: () => Promise<void>;
  remove: () => Promise<void>;
}

/** Pulsante per caricare i dati di esempio, oppure per toglierli (con conferma) se ci sono già. */
export default function DemoButton({ demo, primary = false }: { demo: Demo; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  if (demo.count === 0) {
    return (
      <button
        className={"btn small" + (primary ? " primary" : "")}
        disabled={busy}
        onClick={() => run(demo.load)}
      >
        {t("Carica i dati di esempio")}
      </button>
    );
  }
  return (
    <button
      className={"btn small" + (confirm ? " danger" : "")}
      disabled={busy}
      title={t("Toglie solo le note di esempio, anche se le hai modificate. Le tue note restano.")}
      onClick={() => {
        if (confirm) return run(demo.remove);
        setConfirm(true);
        setTimeout(() => setConfirm(false), 4000);
      }}
    >
      {confirm ? t("Confermi?") : t("Togli i dati di esempio")}
    </button>
  );
}
