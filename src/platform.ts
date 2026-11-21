/** Il sistema su cui gira l'app. */
export type Os = "mac" | "windows" | "linux";

/**
 * Dallo user agent della webview (WKWebView su macOS, WebView2 su Windows, WebKitGTK su Linux).
 * Nell'anteprima del browser si forza con `?os=windows` o `?os=linux`.
 */
function detect(): Os {
  const forced = new URLSearchParams(location.search).get("os");
  if (forced === "mac" || forced === "windows" || forced === "linux") return forced;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "mac";
  return "linux";
}

export const os: Os = detect();
export const isMac = os === "mac";

/** Il valore per il sistema attuale. Senza `linux` vale quello di Windows. */
export function byOs<T>(mac: T, windows: T, linux: T = windows): T {
  return os === "mac" ? mac : os === "windows" ? windows : linux;
}

/**
 * Le scorciatoie scritte come su Mac (⌘⇧H, ⇧⌘M, ⌘Invio, ⌘ clic) come si leggono su Windows e
 * Linux (Ctrl+Maiusc+H, Ctrl+Invio, Ctrl clic). `shift` è il nome del tasto nella lingua
 * dell'interfaccia.
 */
export function pcKeys(text: string, shift: string): string {
  return text.replace(/([⌃⌥⇧⌘]+)(.?)/g, (_, mods: string, next: string) => {
    const names: string[] = [];
    if (/[⌃⌘]/.test(mods)) names.push("Ctrl");
    if (mods.includes("⌥")) names.push("Alt");
    if (mods.includes("⇧")) names.push(shift);
    const joined = names.join("+");
    return next && !" +-".includes(next) ? `${joined}+${next}` : joined + next;
  });
}
