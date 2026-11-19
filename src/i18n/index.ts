import en from "./en";

/** Lingue dell'interfaccia. L'italiano è la lingua sorgente: le chiavi di traduzione sono i testi italiani. */
export type Lang = "it" | "en";
export type LangSetting = "system" | Lang;

const DICTS: Record<Lang, Record<string, string> | null> = { it: null, en };

export function systemLang(): Lang {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language ?? "en"];
  return langs[0].toLowerCase().startsWith("it") ? "it" : "en";
}

export function resolveLang(setting: string | null | undefined): Lang {
  return setting === "it" || setting === "en" ? setting : systemLang();
}

let current: Lang = systemLang();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  current = lang;
  document.documentElement.lang = lang;
}

/**
 * Traduce un testo dell'interfaccia. `key` è il testo italiano; i segnaposto `{nome}`
 * vengono sostituiti con `params`. Se manca la traduzione resta l'italiano.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICTS[current]?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Locale per date e orari: la lingua dell'interfaccia con la regione del sistema quando coincide. */
export function locale(): string {
  const sys = navigator.language ?? "";
  if (sys.toLowerCase().startsWith(current)) return sys;
  return current === "it" ? "it-CH" : "en-GB";
}
