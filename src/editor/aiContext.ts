import { api } from "../api";

/**
 * L'AI vista dall'editor. I blocchi non sanno in quale meeting sono né come cresce la
 * trascrizione: lo dice qui la pagina del meeting, e loro chiedono da qui.
 */

export type AssistKind = "answer" | "block" | "rewrite" | "sketch" | "title";

let meetingId: string | null = null;

/** La pagina del meeting dichiara su quale meeting lavora l'editor (null uscendo). */
export function setAiMeeting(id: string | null) {
  meetingId = id;
}

/** Chiede all'AI; note e trascrizione del meeting corrente fanno da contesto. */
export function askAi(request: {
  kind: AssistKind;
  instruction: string;
  current?: string;
  format?: string;
  image?: string;
}): Promise<string> {
  return api.aiAssist({ meetingId, ...request });
}

/** Stato della trascrizione: quanti segmenti ci sono e se si sta registrando. */
export interface TranscriptState {
  count: number;
  live: boolean;
}

let transcript: TranscriptState = { count: 0, live: false };
const listeners = new Set<() => void>();

export const transcriptState = () => transcript;

export function setTranscriptState(next: TranscriptState) {
  if (next.count === transcript.count && next.live === transcript.live) return;
  transcript = next;
  listeners.forEach((fn) => fn());
}

/** Avvisa quando la trascrizione cresce o la registrazione parte o si ferma. */
export function onTranscript(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
