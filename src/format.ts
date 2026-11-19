import { locale, t } from "./i18n";

// i formatter dipendono dalla lingua dell'interfaccia: si ricreano solo quando cambia
let cached: { loc: string; day: Intl.DateTimeFormat; time: Intl.DateTimeFormat } | null = null;
function fmt() {
  const loc = locale();
  if (!cached || cached.loc !== loc) {
    cached = {
      loc,
      day: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }),
      time: new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" }),
    };
  }
  return cached;
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
