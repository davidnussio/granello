import { locale, t } from "./i18n";

// i formatter dipendono dalla lingua dell'interfaccia: si ricreano solo quando cambia
let cached: {
  loc: string;
  hour12: boolean | undefined;
  day: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
  dayMonth: Intl.DateTimeFormat;
  dayMonthYear: Intl.DateTimeFormat;
  long: Intl.DateTimeFormat;
  longYear: Intl.DateTimeFormat;
} | null = null;

/** Ore in formato 12 (AM/PM) o 24; `undefined` lascia decidere la lingua dell'interfaccia. */
let hour12: boolean | undefined;

/**
 * Applica il formato dell'ora scelto nelle Impostazioni: "24", "12", oppure "system", che segue
 * macOS. `system` è ciò che il sistema dice di sé: una scelta forzata, oppure lingua e regione
 * (es. "en-CH") da cui si ricava l'uso del posto.
 */
export function setTimeFormat(
  setting: string,
  system?: { hour12: boolean | null; locale: string | null } | null,
) {
  if (setting === "24") hour12 = false;
  else if (setting === "12") hour12 = true;
  else if (system && system.hour12 !== null) hour12 = system.hour12;
  else {
    try {
      hour12 = new Intl.DateTimeFormat(system?.locale ?? undefined, { hour: "numeric" }).resolvedOptions()
        .hour12;
    } catch {
      hour12 = undefined;
    }
  }
}

function fmt() {
  const loc = locale();
  if (!cached || cached.loc !== loc || cached.hour12 !== hour12) {
    cached = {
      loc,
      hour12,
      day: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }),
      // h23 e non "hour12: false": così la mezzanotte è 00:05 ovunque, mai 24:05
      time: new Intl.DateTimeFormat(loc, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: hour12 === undefined ? undefined : hour12 ? "h12" : "h23",
      }),
      weekday: new Intl.DateTimeFormat(loc, { weekday: "short" }),
      dayMonth: new Intl.DateTimeFormat(loc, { day: "numeric", month: "short" }),
      dayMonthYear: new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", year: "numeric" }),
      long: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }),
      longYear: new Intl.DateTimeFormat(loc, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    };
  }
  return cached;
}

/**
 * Giorno e ora per intero, da usare dentro una frase: «lunedì 26 ottobre, 09:30» (con l'anno se
 * non è questo), senza «oggi» o «ieri» e con le maiuscole della lingua.
 */
export function longWhen(ts: number): string {
  const d = new Date(ts);
  const f = fmt();
  return `${(d.getFullYear() === new Date().getFullYear() ? f.long : f.longYear).format(d)}, ${time(ts)}`;
}

/** true se i due istanti cadono nello stesso giorno, nell'ora di questo Mac. */
export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number): string {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);
  if (diff === 0) return t("Oggi");
  if (diff === 1) return t("Ieri");
  if (diff === -1) return t("Domani");
  const s = fmt().day.format(new Date(ts));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Quando, in poco spazio (le righe della barra laterale): l'ora se è oggi, «ieri», il giorno
 * della settimana nell'ultima settimana, altrimenti giorno e mese (con l'anno se non è questo).
 */
export function shortWhen(ts: number): string {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);
  if (diff === 0) return time(ts);
  if (diff === 1) return t("ieri");
  const f = fmt();
  const d = new Date(ts);
  // senza il punto delle abbreviazioni («ven.», «Sun.»): nella colonna stretta è solo rumore
  if (diff > 1 && diff < 7) return f.weekday.format(d).replace(/\.$/, "");
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? f.dayMonth : f.dayMonthYear).format(d).replace(/\.(?=\s|$)/g, "");
}

/** Giorno della settimana e ora, senza il punto dell'abbreviazione: «dom 17:08». */
export function weekdayTime(ts: number): string {
  return `${fmt().weekday.format(new Date(ts)).replace(/\.$/, "")} ${time(ts)}`;
}

export function time(ts: number): string {
  return fmt().time.format(new Date(ts));
}

export function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function groupByDay<T>(items: T[], ts: (t: T) => number): [string, T[]][] {
  const out: [string, T[]][] = [];
  for (const it of items) {
    const label = dayLabel(ts(it));
    const last = out[out.length - 1];
    if (last && last[0] === label) last[1].push(it);
    else out.push([label, [it]]);
  }
  return out;
}
