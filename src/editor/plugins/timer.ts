import { dataBlock, type BlockView } from "../dataBlock";
import { field, h } from "../dom";
import { notify } from "../../api";
import { t } from "../../i18n";
import type { EditorPlugin } from "../types";

interface Timer {
  /** Durata impostata, in secondi. */
  seconds: number;
}

/** Lo stato del conto alla rovescia: vive finché la nota è aperta, non viene salvato. */
interface Running {
  duration: number;
  left: number;
  ticking: number | null;
  /** A che ora (ms) scade il timer in corsa: il tempo resta giusto anche con la finestra in secondo piano. */
  endsAt: number;
}

const MAX = 24 * 60 * 60;
const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** "5" = 5 minuti, "1:30" = un minuto e mezzo. */
export function parseDuration(text: string): number | null {
  const m = /^(\d{1,4})(?::([0-5]?\d))?$/.exec(text.trim());
  if (!m) return null;
  const seconds = Number(m[1]) * 60 + Number(m[2] ?? 0);
  return seconds > 0 && seconds <= MAX ? seconds : null;
}

function render(view: BlockView<Timer>) {
  const duration = view.data.seconds;
  let state = view.local.timer as Running | undefined;
  if (!state) {
    state = { duration, left: duration, ticking: null, endsAt: 0 };
    view.local.timer = state;
    view.cleanup.push(() => state!.ticking !== null && window.clearInterval(state!.ticking));
  }
  const s = state;
  // durata cambiata: si riparte da quella nuova
  if (s.duration !== duration) {
    if (s.ticking !== null) window.clearInterval(s.ticking);
    Object.assign(s, { duration, left: duration, ticking: null });
  }

  const stop = () => {
    if (s.ticking !== null) window.clearInterval(s.ticking);
    s.ticking = null;
  };
  const start = () => {
    if (s.left <= 0) s.left = s.duration;
    s.endsAt = Date.now() + s.left * 1000;
    s.ticking = window.setInterval(() => {
      s.left = Math.max(0, Math.round((s.endsAt - Date.now()) / 1000));
      if (s.left === 0) {
        stop();
        notify(t("Tempo scaduto ({time})", { time: clock(s.duration) }));
      }
      render(view);
    }, 250);
  };

  const running = s.ticking !== null;
  const done = s.left === 0;
  view.dom.classList.toggle("running", running);
  view.dom.classList.toggle("done", done);
  const share = s.duration ? (s.left / s.duration) * 100 : 0;

  // mentre corre si aggiorna solo ciò che cambia, senza rifare i pulsanti sotto il puntatore
  const time = view.dom.querySelector<HTMLElement>(".timer-time");
  const bar = view.dom.querySelector<HTMLElement>(".timer-bar > span");
  if (running && time && bar && view.dom.dataset.running === "1") {
    time.textContent = clock(s.left);
    bar.style.width = `${share}%`;
    return;
  }
  view.dom.dataset.running = running ? "1" : "0";

  view.dom.replaceChildren(
    h(
      "button",
      {
        type: "button",
        class: "timer-toggle",
        title: running ? t("Pausa") : t("Avvia"),
        on: {
          click: () => {
            if (running) stop();
            else start();
            render(view);
          },
        },
      },
      running ? "❚❚" : "▶",
    ),
    running || s.left !== s.duration
      ? h("span", { class: "timer-time" }, clock(s.left))
      : field(
          clock(duration),
          (text) => {
            const seconds = parseDuration(text);
            if (seconds) view.set({ seconds });
            else render(view);
          },
          {
            class: "timer-time",
            title: t("Durata: minuti, o minuti:secondi"),
            attrs: { "data-focus": "time", "aria-label": t("Durata del timer") },
          },
        ),
    h("span", { class: "timer-bar" }, h("span", { style: `width: ${share}%` })),
    h(
      "button",
      {
        type: "button",
        class: "block-btn",
        title: t("Azzera"),
        disabled: !running && s.left === s.duration,
        on: {
          click: () => {
            stop();
            s.left = s.duration;
            render(view);
          },
        },
      },
      "↺",
    ),
  );
}

/**
 * Conto alla rovescia per un punto all'ordine del giorno. In Markdown: `[[timer:05:00]]`.
 * Si salva solo la durata: riaprendo la nota il timer è fermo e pronto a ripartire.
 */
const TimerBlock = dataBlock<Timer>({
  name: "timer",
  tag: "timer",
  empty: { seconds: 300 },
  format: {
    kind: "line",
    match: /^\[\[timer:(\d{1,4}:[0-5]\d)\]\]$/,
    parse: (m) => ({ seconds: parseDuration(m[1]) ?? 300 }),
    write: (data) => `[[timer:${clock(data.seconds)}]]`,
  },
  render,
});

export const timer: EditorPlugin = {
  name: "timer",
  extensions: () => [TimerBlock],
  commands: [
    {
      id: "timer",
      get title() {
        return t("Timer");
      },
      get hint() {
        return t("Conto alla rovescia di 5 minuti");
      },
      icon: "◷",
      get group() {
        return t("Strumenti");
      },
      keywords: ["timer", "conto alla rovescia", "countdown", "tempo", "minuti", "timebox"],
      run: (e) => e.chain().focus().insertContent({ type: "timer" }).run(),
    },
  ],
};
