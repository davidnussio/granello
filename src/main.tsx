import React from "react";
import ReactDOM from "react-dom/client";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

// I link nelle note AI e nella chat si aprono nel browser: seguirli nella webview
// sostituirebbe l'app con la pagina, senza modo di tornare indietro.
document.addEventListener("click", (e) => {
  const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute("href") ?? "";
  if (/^(https?:|mailto:)/i.test(href)) openUrl(href).catch(() => {});
});

window.addEventListener("error", (e) => {
  api.logError(`${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  api.logError(`promise: ${String(e.reason)}`);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
