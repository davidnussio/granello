import { api, errorText, notify } from "../api";
import { t } from "../i18n";

/**
 * Dettatura di una richiesta per l'AI: il microfono registra finché non lo si ferma, poi il
 * testo viene trascritto in locale da whisper, come la trascrizione del meeting.
 */

export type DictationPhase = "idle" | "listening" | "transcribing";

/** Una sola dettatura alla volta: avviarne una ferma quella in corso altrove. */
let active: { cancel(): void } | null = null;

export function createDictation(onPhase: (phase: DictationPhase) => void, onText: (text: string) => void) {
  let phase: DictationPhase = "idle";
  const set = (next: DictationPhase) => {
    phase = next;
    onPhase(next);
  };
  const self = {
    /** Primo clic: ascolta. Secondo clic: ferma e trascrive. */
    async toggle() {
      if (phase === "transcribing") return;
      if (phase === "idle") {
        active?.cancel();
        try {
          await api.dictationStart();
          active = self;
          set("listening");
        } catch (e) {
          notify(errorText(e));
        }
        return;
      }
      set("transcribing");
      active = null;
      try {
        const text = (await api.dictationStop(false)).trim();
        if (text) onText(text);
        else notify(t("Non ho sentito niente: riprova parlando più vicino al microfono"));
      } catch (e) {
        notify(errorText(e));
      } finally {
        set("idle");
      }
    },
    /** Butta via la dettatura in corso (il campo è stato chiuso). */
    cancel() {
      if (phase !== "listening") return;
      if (active === self) active = null;
      set("idle");
      api.dictationStop(true).catch(() => {});
    },
  };
  return self;
}

const MIC_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

export const micTitle = (phase: DictationPhase) =>
  phase === "listening" ? t("Ferma e scrivi quello che ho detto") : phase === "transcribing" ? t("Trascrivo…") : t("Detta la richiesta a voce");

/** Il contenuto del pulsante in ogni fase (HTML fisso, non testo dell'utente). */
export const micContent = (phase: DictationPhase) => (phase === "listening" ? "■" : phase === "transcribing" ? "…" : MIC_ICON);

/** Pulsante microfono per un campo di testo: quello che si detta viene aggiunto al campo. */
export function micButton(input: HTMLInputElement): { button: HTMLButtonElement; cancel(): void } {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mic-btn";
  const paint = (phase: DictationPhase) => {
    button.innerHTML = micContent(phase);
    button.title = micTitle(phase);
    button.setAttribute("aria-label", micTitle(phase));
    button.classList.toggle("on", phase === "listening");
    button.disabled = phase === "transcribing";
  };
  const dictation = createDictation(paint, (text) => {
    input.value = input.value.trim() ? `${input.value.trim()} ${text}` : text;
    input.focus();
  });
  paint("idle");
  // mousedown: il campo non deve perdere il fuoco (e salvare) prima del clic
  button.addEventListener("mousedown", (e) => e.preventDefault());
  button.addEventListener("click", () => dictation.toggle());
  return { button, cancel: () => dictation.cancel() };
}
