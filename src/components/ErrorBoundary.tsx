import { Component, type ErrorInfo, type ReactNode } from "react";
import { api } from "../api";
import { t } from "../i18n";

interface State {
  error: Error | null;
}

/** Evita la finestra bianca se un componente va in errore: le note sono già salvate su disco. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    api.logError(`${error.stack ?? error.message}\n${info.componentStack ?? ""}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h2>{t("Qualcosa è andato storto")}</h2>
        <p className="muted">
          {t(
            "L'interfaccia ha avuto un errore imprevisto. Le tue note e le trascrizioni sono salvate: ricarica per continuare.",
          )}
        </p>
        <pre>{this.state.error.message}</pre>
        <button className="btn primary" onClick={() => window.location.reload()}>
          {t("Ricarica")}
        </button>
      </div>
    );
  }
}
