const dayFmt = new Intl.DateTimeFormat("it-CH", { weekday: "long", day: "numeric", month: "long" });
const timeFmt = new Intl.DateTimeFormat("it-CH", { hour: "2-digit", minute: "2-digit" });

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ts: number): string {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);
  if (diff === 0) return "Oggi";
  if (diff === 1) return "Ieri";
  if (diff === -1) return "Domani";
  const s = dayFmt.format(new Date(ts));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function time(ts: number): string {
  return timeFmt.format(new Date(ts));
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
